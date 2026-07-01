import { getModel } from './db.js';

// User Schema Object
const userSchemaObj = {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
};

// Meeting Schema Object
const meetingSchemaObj = {
    roomId: { type: String, required: true, unique: true },
    host: { type: String, required: true },
    agenda: { type: String, default: '' },
    summary: { type: String, default: '' },
    score: { type: Number, default: 0 },
    isCompleted: { type: Boolean, default: false },
    // Array of participants with statistics
    participants: { type: Array, default: [] },
    // Full transcripts
    transcript: { type: Array, default: [] },
    // Extracted action items
    actionItems: { type: Array, default: [] }
};

// Task/Action Item Schema Object
const taskSchemaObj = {
    meetingId: { type: String, required: true },
    title: { type: String, required: true },
    assignee: { type: String, default: 'Unassigned' },
    status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
    dueDate: { type: String, default: '' }
};

// Compile models
export const User = getModel('User', userSchemaObj);
export const Meeting = getModel('Meeting', meetingSchemaObj);
export const Task = getModel('Task', taskSchemaObj);
