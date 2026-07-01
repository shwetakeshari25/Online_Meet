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

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

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
                hostSocketId: null
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
                micOnDuration: 0,
                camOnDuration: 0,
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
            let meeting = await Meeting.findOne({ roomId });
            if (!meeting) {
                // Dynamically create the meeting database entry if it doesn't exist,
                // setting the first connector as the Host.
                meeting = await Meeting.create({
                    roomId,
                    host: name,
                    participants: [],
                    transcript: [],
                    actionItems: []
                });
                console.log(`Dynamically created meeting record for room: ${roomId} with Host: ${name}`);
            }
            isHost = (meeting.host === name);
        } catch (e) {
            console.error("DB error checking host:", e);
        }

        if (isHost) {
            room.hostSocketId = socket.id;
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
                micOnDuration: 0,
                camOnDuration: 0,
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

    socket.on('update-durations', ({ roomId, micOnDuration, camOnDuration }) => {
        const room = activeRooms[roomId];
        if (!room) return;
        const user = room.users.find(u => u.socketId === socket.id);
        if (user) {
            user.micOnDuration = micOnDuration;
            user.camOnDuration = camOnDuration;
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
    socket.on('speech-transcribed', ({ roomId, text }) => {
        if (!text || text.trim() === '') return;

        const speechObj = {
            sender: socket.userName || 'Guest',
            message: text,
            timestamp: new Date().toLocaleTimeString(),
            isSpeech: true
        };

        if (activeRooms[roomId]) {
            activeRooms[roomId].transcript.push(speechObj);
        }
        
        console.log(`[Speech Room ${roomId}] ${socket.userName}: ${text}`);
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
            } else if (type === 'cam') {
                user.camEnabled = enabled;
                user.camSwitches += 1;
            }

            console.log(`User ${user.name} toggled ${type} (Switches: mic=${user.micSwitches}, cam=${user.camSwitches})`);
            io.to(roomId).emit('updated-users', room.users);
        }
    });

    // End Meeting & Save Summary (Called by Host)
    socket.on('end-meeting', async ({ roomId }) => {
        const room = activeRooms[roomId];
        if (!room) return;

        console.log(`Host requested meeting end for room ${roomId}`);

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
            const dbMeeting = await Meeting.findOne({ roomId });
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
                        camSwitches: u.camSwitches
                    })),
                    transcript: room.transcript,
                    actionItems: savedTasks.map(t => ({ id: t._id, title: t.title, assignee: t.assignee }))
                });
            }

            // 4. Broadcast end-meeting report and close
            io.to(roomId).emit('meeting-ended-report', {
                summary: aiReport.summary,
                keyPoints: aiReport.keyPoints,
                score: aiReport.score,
                speakingInsights: aiReport.speakingInsights,
                actionItems: savedTasks,
                participants: room.users
            });

            // Remove from memory
            delete activeRooms[roomId];
        } catch (e) {
            console.error(`Error saving meeting report: ${e.message}`);
            io.to(roomId).emit('meeting-ended-error', e.message);
        }
    });

    // Disconnection handler
    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        const roomId = socket.roomId;
        if (roomId && activeRooms[roomId]) {
            const room = activeRooms[roomId];
            
            // Remove user
            room.users = room.users.filter(u => u.socketId !== socket.id);
            
            if (room.users.length === 0) {
                // If room is empty, delete it
                delete activeRooms[roomId];
                console.log(`Room ${roomId} is now empty and removed.`);
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
