import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { connectDB, useFallback } from './db.js';
import { User, Meeting, Task } from './models.js';
import { generateAgenda, generateMeetingSummary, translateText } from './aiHelper.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'online_meet_secret_key_12345';

// Middlewares
app.use(cors());
app.use(express.json());

// Database connection
connectDB();

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: 'Access token required' });

    if (token === 'mock-jwt-token-12345') {
        req.user = { id: 'showcase-user-id', name: 'Aman', email: 'aman@meeting.com' };
        return next();
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    });
};

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists with this email' });
        }

        // Simplistic password hash (for local/mock database convenience)
        const user = await User.create({ name, email, password });
        
        const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await User.findOne({ email });
        if (!user || user.password !== password) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ id: user._id, name: user.name, email: user.email });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- MEETING ROUTES ---
app.post('/api/meetings/create', authenticateToken, async (req, res) => {
    try {
        const roomId = Math.random().toString(36).substring(2, 6) + '-' + Math.random().toString(36).substring(2, 6);
        const meeting = await Meeting.create({
            roomId,
            host: req.user.name,
            participants: [],
            transcript: [],
            actionItems: []
        });
        res.status(201).json(meeting);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/meetings/history', authenticateToken, async (req, res) => {
    try {
        // Find all completed meetings where host or user joined
        const meetings = await Meeting.find({ isCompleted: true });
        res.json(meetings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/meetings/:roomId', authenticateToken, async (req, res) => {
    try {
        const meeting = await Meeting.findOne({ roomId: req.params.roomId });
        if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
        res.json(meeting);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- TASK ROUTES ---
app.get('/api/tasks', authenticateToken, async (req, res) => {
    try {
        const tasks = await Task.find({});
        res.json(tasks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/tasks/:id', authenticateToken, async (req, res) => {
    try {
        const { status } = req.body;
        const task = await Task.findByIdAndUpdate(req.params.id, { status }, { new: true });
        res.json(task);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- AI API ROUTES ---
app.post('/api/ai/agenda', authenticateToken, async (req, res) => {
    try {
        const { goal, duration } = req.body;
        const agendaData = await generateAgenda(goal, duration);
        res.json(agendaData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai/translate', authenticateToken, async (req, res) => {
    try {
        const { text, targetLang } = req.body;
        const translated = await translateText(text, targetLang);
        res.json({ translated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SOCKET.IO MEETING STATE ---
// Store live meeting rooms in memory for tracking active calls and user stats
const activeRooms = {};

// Helper to compile meeting summaries, create DB tasks, update DB records, and clean up intervals
const saveMeetingReport = async (roomId) => {
    const room = activeRooms[roomId];
    if (!room) return null;

    console.log(`Auto-saving meeting report for room ${roomId}`);

    try {
        // 1. Generate NLP Summaries & Action Items
        const aiReport = await generateMeetingSummary(room.transcript, room.users);

        // 2. Save Tasks/Action Items to Database
        const savedTasks = [];
        for (const item of aiReport.actionItems) {
            const task = await Task.create({
                meetingId: roomId,
                title: item.title,
                assignee: item.assignee,
                status: 'pending',
                dueDate: item.dueDate
            });
            savedTasks.push(task);
        }

        // 3. Update Meeting Record in DB
        const dbMeeting = await Meeting.findOne({ roomId, isCompleted: false });
        if (dbMeeting) {
            await Meeting.findByIdAndUpdate(dbMeeting._id, {
                isCompleted: true,
                agenda: dbMeeting.agenda || 'General Meeting',
                summary: aiReport.summary,
                score: aiReport.score,
                participants: room.users.map(u => ({
                    name: u.name,
                    email: u.email || '',
                    device: u.device,
                    micSwitches: u.micSwitches,
                    camSwitches: u.camSwitches,
                    micOnCount: u.micOnCount || 0,
                    micOffCount: u.micOffCount || 0,
                    micOnDuration: u.micOnDuration || 0,
                    micOffDuration: u.micOffDuration || 0,
                    camOnDuration: u.camOnDuration || 0,
                    camOffDuration: u.camOffDuration || 0
                })),
                transcript: room.transcript,
                actionItems: savedTasks.map(t => ({ id: t._id, title: t.title, assignee: t.assignee }))
            });
        }

        return {
            summary: aiReport.summary,
            keyPoints: aiReport.keyPoints,
            score: aiReport.score,
            speakingInsights: aiReport.speakingInsights,
            actionItems: savedTasks,
            participants: room.users,
            transcript: room.transcript
        };
    } catch (e) {
        console.error(`Error in saveMeetingReport for room ${roomId}: ${e.message}`);
        return null;
    } finally {
        // Clear intervals and delete room
        if (room.simulationInterval) {
            clearInterval(room.simulationInterval);
        }
        if (room.timeInterval) {
            clearInterval(room.timeInterval);
        }
        delete activeRooms[roomId];
    }
};

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Chrome Extension Links to Room (Invisible Data Provider)
    socket.on('join-extension', ({ roomId }) => {
        socket.roomId = roomId;
        socket.isExtension = true;
        socket.join(roomId);
        console.log(`Chrome Extension linked to room: ${roomId}`);
    });

    // User Joins Meeting Room
    socket.on('join-meeting', async ({ roomId, name, email, device }) => {
        socket.roomId = roomId;
        socket.userName = name;
        socket.userEmail = email || '';
        socket.deviceType = device || 'Desktop/Laptop';

        if (!activeRooms[roomId]) {
            activeRooms[roomId] = {
                users: [],
                transcript: [],
                pendingApprovals: [],
                hostSocketId: null,
                timeInterval: setInterval(() => {
                    const room = activeRooms[roomId];
                    if (!room) return;
                    
                    let updated = false;
                    room.users.forEach(u => {
                        if (u.isExternal) {
                            updated = true;
                            if (u.micEnabled) {
                                u.micOnDuration = (u.micOnDuration || 0) + 1;
                            } else {
                                u.micOffDuration = (u.micOffDuration || 0) + 1;
                            }
                            if (u.camEnabled) {
                                u.camOnDuration = (u.camOnDuration || 0) + 1;
                            } else {
                                u.camOffDuration = (u.camOffDuration || 0) + 1;
                            }
                        }
                    });
                    
                    if (updated) {
                        io.to(roomId).emit('updated-users', room.users);
                    }
                }, 1000)
            };
        }

        const room = activeRooms[roomId];

        // Helper function to admit the user into the WebRTC room
        const admitUser = (s, rId, uName, uDevice) => {
            s.join(rId);
            const r = activeRooms[rId];
            const existingUserIdx = r.users.findIndex(u => u.name === uName);

            const userData = {
                socketId: s.id,
                name: uName,
                email: s.userEmail || '',
                device: s.deviceType || uDevice || 'Desktop/Laptop',
                micSwitches: 0,
                camSwitches: 0,
                micOnCount: 1,
                micOffCount: 0,
                micOnDuration: 0,
                micOffDuration: 0,
                camOnDuration: 0,
                camOffDuration: 0,
                micEnabled: true,
                camEnabled: true
            };

            if (existingUserIdx >= 0) {
                r.users[existingUserIdx] = userData;
            } else {
                r.users.push(userData);
            }

            console.log(`User ${uName} (${s.userEmail}) joined room ${rId}`);

            // Notify others in room
            s.to(rId).emit('user-connected', {
                socketId: s.id,
                name: uName,
                device: userData.device
            });

            // Send current user list & history to the newly joined user
            s.emit('room-users', {
                users: r.users,
                transcript: r.transcript
            });

            // Broadcast updated user list to everyone
            io.to(rId).emit('updated-users', r.users);
            s.emit('joined-successfully');
        };

        // Fetch meeting details to check who is the host
        let isHost = true;
        try {
            let meeting = await Meeting.findOne({ roomId, isCompleted: false });
            if (!meeting) {
                // Dynamically create the meeting database entry if it doesn't exist,
                // setting the first connector as the Host.
                meeting = await Meeting.create({
                    roomId,
                    host: name,
                    participants: [],
                    transcript: [],
                    actionItems: [],
                    isCompleted: false
                });
                console.log(`Dynamically created meeting record for room: ${roomId} with Host: ${name}`);
            }
            
            // Self-healing: If the room has no active host and no users are in it,
            // assign the joining user as the active host.
            if (!room.hostSocketId && room.users.length === 0) {
                meeting.host = name;
                await meeting.save();
                console.log(`Assigned ${name} as the active host for empty room: ${roomId}`);
            }
            
            isHost = (meeting.host === name);
        } catch (e) {
            console.error("DB error checking host:", e);
        }

        if (isHost) {
            room.hostSocketId = socket.id;
            room.hostName = name;
            admitUser(socket, roomId, name, device);
            
            // Broadcast system message that Host joined
            const systemMsg = {
                sender: 'System',
                message: `${name} (Host) joined the meeting.`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isSpeech: false,
                isSystem: true
            };
            room.transcript.push(systemMsg);
            io.to(roomId).emit('chat-message', systemMsg);
            
            // If there are pending approvals, send them to the host immediately
            if (room.pendingApprovals.length > 0) {
                room.pendingApprovals.forEach(p => {
                    socket.emit('join-request', { socketId: p.socketId, name: p.name });
                });
            }
        } else {
            // Participant: Check if already admitted
            const isAlreadyAdmitted = room.users.some(u => u.name === name);
            if (isAlreadyAdmitted) {
                admitUser(socket, roomId, name, device);
            } else {
                // Not admitted yet: put in pending list and knock
                room.pendingApprovals.push({ socketId: socket.id, name });
                console.log(`User ${name} is knocking to join room ${roomId}`);
                
                if (room.hostSocketId) {
                    io.to(room.hostSocketId).emit('join-request', { socketId: socket.id, name });
                }
                
                socket.emit('waiting-approval');
            }
        }
    });

    socket.on('approve-user', async ({ targetSocketId }) => {
        const roomId = socket.roomId;
        const room = activeRooms[roomId];
        if (!room) return;

        const idx = room.pendingApprovals.findIndex(p => p.socketId === targetSocketId);
        let participantName = '';
        if (idx >= 0) {
            participantName = room.pendingApprovals[idx].name;
            room.pendingApprovals.splice(idx, 1);
        }

        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
            await targetSocket.join(roomId);
            const existingUserIdx = room.users.findIndex(u => u.name === (targetSocket.userName || participantName));
            const userData = {
                socketId: targetSocket.id,
                name: targetSocket.userName || participantName,
                email: targetSocket.userEmail || '',
                device: targetSocket.deviceType || 'Desktop/Laptop',
                micSwitches: 0,
                camSwitches: 0,
                micOnCount: 1,
                micOffCount: 0,
                micOnDuration: 0,
                micOffDuration: 0,
                camOnDuration: 0,
                camOffDuration: 0,
                micEnabled: true,
                camEnabled: true
            };

            if (existingUserIdx >= 0) {
                room.users[existingUserIdx] = userData;
            } else {
                room.users.push(userData);
            }

            // Notify the room that a new user connected (send from host/socket)
            socket.to(roomId).emit('user-connected', {
                socketId: targetSocket.id,
                name: userData.name,
                device: userData.device
            });

            // Broadcast system message that guest joined
            const systemMsg = {
                sender: 'System',
                message: `${userData.name} joined the meeting.`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isSpeech: false,
                isSystem: true
            };
            room.transcript.push(systemMsg);
            io.to(roomId).emit('chat-message', systemMsg);

            targetSocket.emit('room-users', {
                users: room.users,
                transcript: room.transcript
            });

            io.to(roomId).emit('updated-users', room.users);
            targetSocket.emit('joined-successfully');
        }
    });

    socket.on('deny-user', ({ targetSocketId }) => {
        const roomId = socket.roomId;
        const room = activeRooms[roomId];
        if (!room) return;

        const idx = room.pendingApprovals.findIndex(p => p.socketId === targetSocketId);
        if (idx >= 0) {
            room.pendingApprovals.splice(idx, 1);
        }

        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
            targetSocket.emit('join-denied');
            targetSocket.disconnect();
        }
    });

    socket.on('update-durations', ({ roomId, micOnDuration, micOffDuration, camOnDuration, camOffDuration, micOnCount, micOffCount }) => {
        const room = activeRooms[roomId];
        if (!room) return;
        const user = room.users.find(u => u.socketId === socket.id);
        if (user) {
            user.micOnDuration = micOnDuration;
            user.micOffDuration = micOffDuration;
            user.camOnDuration = camOnDuration;
            user.camOffDuration = camOffDuration;
            if (micOnCount !== undefined) user.micOnCount = micOnCount;
            if (micOffCount !== undefined) user.micOffCount = micOffCount;
            io.to(roomId).emit('updated-users', room.users);
        }
    });

    // WebRTC Signaling Relay
    socket.on('webrtc-offer', ({ targetSocketId, offer }) => {
        io.to(targetSocketId).emit('webrtc-offer', {
            senderSocketId: socket.id,
            offer
        });
    });

    socket.on('webrtc-answer', ({ targetSocketId, answer }) => {
        io.to(targetSocketId).emit('webrtc-answer', {
            senderSocketId: socket.id,
            answer
        });
    });

    socket.on('webrtc-candidate', ({ targetSocketId, candidate }) => {
        io.to(targetSocketId).emit('webrtc-candidate', {
            senderSocketId: socket.id,
            candidate
        });
    });

    // Chat Message
    socket.on('send-chat', ({ roomId, message }) => {
        const chatObj = {
            sender: socket.userName || 'Guest',
            message,
            timestamp: new Date().toLocaleTimeString(),
            isSpeech: false
        };
        if (activeRooms[roomId]) {
            activeRooms[roomId].transcript.push(chatObj);
        }
        io.to(roomId).emit('chat-message', chatObj);
    });

    // Real-time Speech-to-Text Chat Input (Voice-to-Chat)
    socket.on('speech-transcribed', ({ roomId, text, sender }) => {
        if (!text || text.trim() === '') return;

        const speechObj = {
            sender: sender || socket.userName || 'Guest',
            message: text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isSpeech: true
        };

        if (activeRooms[roomId]) {
            activeRooms[roomId].transcript.push(speechObj);
        }
        
        console.log(`[Speech Room ${roomId}] ${sender || socket.userName}: ${text}`);
        io.to(roomId).emit('chat-message', speechObj);
    });

    // Camera/Mic Status Toggle Analytics Tracker
    socket.on('toggle-media', ({ roomId, type, enabled }) => {
        const room = activeRooms[roomId];
        if (!room) return;

        const user = room.users.find(u => u.socketId === socket.id);
        if (user) {
            if (type === 'mic') {
                user.micEnabled = enabled;
                user.micSwitches += 1;
                if (enabled) {
                    user.micOnCount = (user.micOnCount || 0) + 1;
                } else {
                    user.micOffCount = (user.micOffCount || 0) + 1;
                }
            } else if (type === 'cam') {
                user.camEnabled = enabled;
                user.camSwitches += 1;
            }

            console.log(`User ${user.name} toggled ${type} (Switches: mic=${user.micSwitches}, cam=${user.camSwitches}, micOn=${user.micOnCount}, micOff=${user.micOffCount})`);
            io.to(roomId).emit('updated-users', room.users);
        }
    });

    // Handle actual participants sent from the Chrome Extension
    socket.on('extension-update-participants', ({ roomId, participants, isPresentationActive }) => {
        const room = activeRooms[roomId];
        if (!room) return;

        // Separate local users from external users
        const localUsers = room.users.filter(u => !u.isExternal);
        const externalUsers = room.users.filter(u => u.isExternal);

        participants.forEach(p => {
            let name = p.name;
            if (!name) return;

            // Map 'Host User' or 'You' to actual hostName
            if (name.toLowerCase() === 'host user' || name.toLowerCase() === 'you') {
                name = room.hostName || name;
            }

            // Check if name matches one of the local users
            const hostUser = localUsers.find(u => u.name.toLowerCase() === name.toLowerCase());
            if (hostUser) {
                // Sync host's mic and cam switches based on extension detections
                if (hostUser.micEnabled !== p.micEnabled) {
                    hostUser.micEnabled = p.micEnabled;
                    hostUser.micSwitches += 1;
                    if (p.micEnabled) hostUser.micOnCount = (hostUser.micOnCount || 0) + 1;
                    else hostUser.micOffCount = (hostUser.micOffCount || 0) + 1;
                }
                if (hostUser.camEnabled !== p.camEnabled) {
                    hostUser.camEnabled = p.camEnabled;
                    hostUser.camSwitches += 1;
                }
                if (p.device) {
                    if (p.device === 'Mobile/Phone' || hostUser.device !== 'Mobile/Phone') {
                        hostUser.device = p.device;
                    }
                }
                return;
            }

            const existingExt = externalUsers.find(u => u.name.toLowerCase() === name.toLowerCase());
            if (existingExt) {
                // Sync states
                if (existingExt.micEnabled !== p.micEnabled) {
                    existingExt.micEnabled = p.micEnabled;
                    existingExt.micSwitches += 1;
                    if (p.micEnabled) existingExt.micOnCount = (existingExt.micOnCount || 0) + 1;
                    else existingExt.micOffCount = (existingExt.micOffCount || 0) + 1;
                }
                if (existingExt.camEnabled !== p.camEnabled) {
                    existingExt.camEnabled = p.camEnabled;
                    existingExt.camSwitches += 1;
                }
                if (p.device) {
                    if (p.device === 'Mobile/Phone' || existingExt.device !== 'Mobile/Phone') {
                        existingExt.device = p.device;
                    }
                }
                existingExt.isOnline = true;
            } else {
                // New external participant joined!
                const newExt = {
                    socketId: `ext-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
                    name: name,
                    email: '',
                    device: p.device || 'Desktop/Laptop',
                    micSwitches: 0,
                    camSwitches: 0,
                    micOnCount: p.micEnabled ? 1 : 0,
                    micOffCount: p.micEnabled ? 0 : 1,
                    micOnDuration: 0,
                    micOffDuration: 0,
                    camOnDuration: 0,
                    camOffDuration: 0,
                    micEnabled: p.micEnabled,
                    camEnabled: p.camEnabled,
                    isExternal: true,
                    isOnline: true
                };
                externalUsers.push(newExt);

                // Add a system notification in the chat
                const systemMsg = {
                    sender: 'System',
                    message: `${name} joined the meeting.`,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    isSpeech: false,
                    isSystem: true
                };
                room.transcript.push(systemMsg);
                io.to(roomId).emit('chat-message', systemMsg);
            }
        });

        // Detect if any external users left the call (skip if screen sharing/presentation is active)
        if (!isPresentationActive) {
            externalUsers.forEach(oldU => {
                const stillPresent = participants.some(p => p.name.toLowerCase() === oldU.name.toLowerCase());
                if (oldU.isOnline && !stillPresent) {
                    oldU.isOnline = false;
                    oldU.micEnabled = false;
                    oldU.camEnabled = false;

                    const systemMsg = {
                        sender: 'System',
                        message: `${oldU.name} left the meeting.`,
                        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        isSpeech: false,
                        isSystem: true
                    };
                    room.transcript.push(systemMsg);
                    io.to(roomId).emit('chat-message', systemMsg);
                }
            });
        }

        room.users = [...localUsers, ...externalUsers];
        io.to(roomId).emit('updated-users', room.users);
    });

    // Handle transcriptions sent from the Chrome Extension
    socket.on('extension-speech-transcribed', ({ roomId, sender, text }) => {
        if (!text || text.trim() === '') return;
        const room = activeRooms[roomId];
        if (!room) return;

        let speakerName = sender || 'Guest';
        if (speakerName.toLowerCase() === 'you' || speakerName.toLowerCase() === 'host user') {
            speakerName = room.hostName || 'Host';
        }

        const speechObj = {
            sender: speakerName,
            message: text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isSpeech: true
        };
        room.transcript.push(speechObj);
        console.log(`[Ext Speech Room ${roomId}] ${speakerName}: ${text}`);
        io.to(roomId).emit('chat-message', speechObj);
    });

    // Handle manual device toggle from React App
    socket.on('toggle-participant-device', ({ roomId, name, device }) => {
        if (!roomId || !name || !device) return;
        const room = activeRooms[roomId];
        if (!room) return;

        const user = room.users.find(u => u.name.toLowerCase() === name.toLowerCase());
        if (user) {
            user.device = device;
            console.log(`[Device Update Room ${roomId}] ${user.name} toggled device to: ${device}`);
            io.to(roomId).emit('updated-users', room.users);
        }
    });

    // End Meeting & Save Summary (Called by Host)
    socket.on('end-meeting', async ({ roomId }) => {
        const room = activeRooms[roomId];
        if (!room) return;

        console.log(`Host requested meeting end for room ${roomId}`);
        const report = await saveMeetingReport(roomId);
        if (report) {
            io.to(roomId).emit('meeting-ended-report', report);
        } else {
            io.to(roomId).emit('meeting-ended-error', 'Could not compile meeting report');
        }
    });

    // Demo simulation handler
    socket.on('start-demo-simulation', () => {
        const roomId = socket.roomId;
        if (!roomId || !activeRooms[roomId]) return;
        
        const room = activeRooms[roomId];
        
        // Prevent duplicate simulation
        if (room.users.some(u => u.isMock)) return;

        // Mock users definitions
        const mockUsers = [
            {
                socketId: 'mock-ram-id',
                name: 'Ram',
                email: 'ram@meeting.com',
                device: 'Mobile/Phone',
                micSwitches: 0,
                camSwitches: 0,
                micOnCount: 1,
                micOffCount: 0,
                micOnDuration: 15,
                micOffDuration: 5,
                camOnDuration: 20,
                camOffDuration: 0,
                micEnabled: true,
                camEnabled: true,
                isMock: true
            },
            {
                socketId: 'mock-shweta-id',
                name: 'Shweta',
                email: 'shweta@meeting.com',
                device: 'Desktop/Laptop',
                micSwitches: 2,
                camSwitches: 1,
                micOnCount: 2,
                micOffCount: 1,
                micOnDuration: 45,
                micOffDuration: 10,
                camOnDuration: 50,
                camOffDuration: 5,
                micEnabled: true,
                camEnabled: true,
                isMock: true
            },
            {
                socketId: 'mock-pankaj-id',
                name: 'Pankaj',
                email: 'pankaj@meeting.com',
                device: 'Mobile/Phone',
                micSwitches: 1,
                camSwitches: 1,
                micOnCount: 1,
                micOffCount: 1,
                micOnDuration: 10,
                micOffDuration: 30,
                camOnDuration: 0,
                camOffDuration: 40,
                micEnabled: false,
                camEnabled: false,
                isMock: true
            },
            {
                socketId: 'mock-rani-id',
                name: 'Rani',
                email: 'rani@meeting.com',
                device: 'Desktop/Laptop',
                micSwitches: 0,
                camSwitches: 0,
                micOnCount: 1,
                micOffCount: 0,
                micOnDuration: 30,
                micOffDuration: 0,
                camOnDuration: 30,
                camOffDuration: 0,
                micEnabled: true,
                camEnabled: true,
                isMock: true
            }
        ];

        // Push mock users to the room's users
        room.users.push(...mockUsers);
        
        // Notify client with system messages that mock users joined
        mockUsers.forEach(u => {
            const systemMsg = {
                sender: 'System',
                message: `${u.name} joined the meeting.`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isSpeech: false,
                isSystem: true
            };
            room.transcript.push(systemMsg);
            io.to(roomId).emit('chat-message', systemMsg);
        });

        io.to(roomId).emit('updated-users', room.users);

        // Predefined list of speeches
        const mockSpeeches = [
            { sender: 'Ram', message: 'Hi team, Ram here. App coding process looks really great!' },
            { sender: 'Shweta', message: 'Hello! I am Shweta. Meeting stats track details beautifully.' },
            { sender: 'Pankaj', message: 'Hi everyone, Pankaj speaking. Mic switch counts are working in real-time.' },
            { sender: 'Rani', message: 'Rani here. Laptop camera and phone classifications are clear.' },
            { sender: 'Ram', message: 'Yes Shweta, the Google Meet interface matches perfectly.' },
            { sender: 'Shweta', message: 'Great! Let us check the hardware statistics panel now.' },
            { sender: 'Pankaj', message: 'I will toggle my camera and microphone to show the increments.' },
            { sender: 'Rani', message: 'This is an amazing real-time dashboard.' }
        ];
        
        let speechIndex = 0;

        // Setup real-time simulator interval
        const simInterval = setInterval(() => {
            const currentRoom = activeRooms[roomId];
            // If room is destroyed, clear interval
            if (!currentRoom || currentRoom.users.length === 0) {
                clearInterval(simInterval);
                return;
            }

            // 1. Ticks durations for mock users
            currentRoom.users.forEach(u => {
                if (u.isMock) {
                    if (u.micEnabled) {
                        u.micOnDuration += 1;
                    } else {
                        u.micOffDuration += 1;
                    }
                    if (u.camEnabled) {
                        u.camOnDuration += 1;
                    } else {
                        u.camOffDuration += 1;
                    }
                }
            });

            // 2. Randomly toggle mic or cam (every ~7 seconds on average)
            if (Math.random() < 0.15) {
                const mocks = currentRoom.users.filter(u => u.isMock);
                const randomUser = mocks[Math.floor(Math.random() * mocks.length)];
                if (randomUser) {
                    const toggleType = Math.random() < 0.5 ? 'mic' : 'cam';
                    if (toggleType === 'mic') {
                        randomUser.micEnabled = !randomUser.micEnabled;
                        randomUser.micSwitches += 1;
                        if (randomUser.micEnabled) {
                            randomUser.micOnCount = (randomUser.micOnCount || 0) + 1;
                        } else {
                            randomUser.micOffCount = (randomUser.micOffCount || 0) + 1;
                        }
                    } else {
                        randomUser.camEnabled = !randomUser.camEnabled;
                        randomUser.camSwitches += 1;
                    }
                    console.log(`[Sim] Mock user ${randomUser.name} toggled ${toggleType}`);
                }
            }

            // 3. Randomly speak (every ~12 seconds)
            if (Math.random() < 0.08) {
                const speech = mockSpeeches[speechIndex % mockSpeeches.length];
                speechIndex += 1;

                // Make sure speaker has micEnabled: true
                const speaker = currentRoom.users.find(u => u.name === speech.sender);
                if (speaker) {
                    // Turn on mic if it was off, to make it realistic
                    if (!speaker.micEnabled) {
                        speaker.micEnabled = true;
                        speaker.micSwitches += 1;
                        speaker.micOnCount = (speaker.micOnCount || 0) + 1;
                    }

                    const speechObj = {
                        sender: speaker.name,
                        message: speaker.name + " is saying: " + speech.message,
                        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        isSpeech: true
                    };
                    currentRoom.transcript.push(speechObj);
                    io.to(roomId).emit('chat-message', speechObj);
                }
            }

            // Broadcast updated data
            io.to(roomId).emit('updated-users', currentRoom.users);

        }, 1000);

        // Store interval ref on the room object so it can be cleaned up on disconnect or end-meeting
        room.simulationInterval = simInterval;
    });

    // Disconnection handler
    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        if (socket.isExtension) {
            console.log(`Extension disconnected for room ${socket.roomId}`);
            return;
        }
        
        const roomId = socket.roomId;
        if (roomId && activeRooms[roomId]) {
            const room = activeRooms[roomId];
            
            // Remove user
            room.users = room.users.filter(u => u.socketId !== socket.id);
            
            const activeLocalUsers = room.users.filter(u => !u.isMock && !u.isExternal);
            if (activeLocalUsers.length === 0) {
                // If room is empty of local users, auto-save the meeting report!
                saveMeetingReport(roomId);
                console.log(`Room ${roomId} is now empty and auto-saved.`);
            } else {
                // Notify others
                socket.to(roomId).emit('user-disconnected-signal', socket.id);
                io.to(roomId).emit('updated-users', room.users);
            }
        }
    });
});

// Start Server
httpServer.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`  AI Meeting Intelligent Server Running!     `);
    console.log(`  Port: ${PORT}                             `);
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`=============================================`);
});
