import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

let dbConnected = false;
let useFallback = false;

// Attempt MongoDB Connection
export const connectDB = async () => {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/online_meet';
    try {
        mongoose.set('strictQuery', false);
        console.log('=> Connecting to MongoDB...');
        await mongoose.connect(mongoURI, {
            serverSelectionTimeoutMS: 2000 // fail fast
        });
        dbConnected = true;
        console.log('=> MongoDB connected successfully.');
    } catch (err) {
        console.log(`=> MongoDB connection failed: ${err.message}`);
        console.log('=> Falling back to Local JSON database (JSONDB)...');
        useFallback = true;
    }
};

// Generate UUID for fallback docs
const generateId = () => Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

// Local JSON file database model
class JSONDBModel {
    constructor(collectionName) {
        this.filePath = path.join(DATA_DIR, `${collectionName.toLowerCase()}.json`);
        this.collectionName = collectionName;
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify([]));
        }
    }

    _read() {
        try {
            const data = fs.readFileSync(this.filePath, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            return [];
        }
    }

    _write(data) {
        fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    }

    async find(query = {}) {
        const records = this._read();
        return records.filter(item => {
            for (const key in query) {
                if (item[key] !== query[key]) return false;
            }
            return true;
        });
    }

    async findOne(query = {}) {
        const records = this._read();
        return records.find(item => {
            for (const key in query) {
                if (item[key] !== query[key]) return false;
            }
            return true;
        }) || null;
    }

    async findById(id) {
        const records = this._read();
        return records.find(item => item._id === id || item.id === id) || null;
    }

    async create(data) {
        const records = this._read();
        const newRecord = {
            _id: generateId(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ...data
        };
        
        // Add save helper to mimic mongoose document save
        const modelInstance = this;
        newRecord.save = async function() {
            const currentRecords = modelInstance._read();
            const idx = currentRecords.findIndex(r => r._id === this._id);
            const docToWrite = { ...this };
            delete docToWrite.save;
            
            if (idx >= 0) {
                docToWrite.updatedAt = new Date().toISOString();
                currentRecords[idx] = docToWrite;
            } else {
                currentRecords.push(docToWrite);
            }
            modelInstance._write(currentRecords);
            return this;
        };

        records.push(newRecord);
        this._write(records);
        return newRecord;
    }

    async findByIdAndUpdate(id, update, options = {}) {
        const records = this._read();
        const idx = records.findIndex(item => item._id === id || item.id === id);
        if (idx === -1) return null;

        const updated = {
            ...records[idx],
            ...update,
            updatedAt: new Date().toISOString()
        };
        
        records[idx] = updated;
        this._write(records);
        return updated;
    }

    async deleteOne(query = {}) {
        const records = this._read();
        const filtered = records.filter(item => {
            for (const key in query) {
                if (item[key] !== query[key]) return true;
            }
            return false;
        });
        this._write(filtered);
        return { deletedCount: records.length - filtered.length };
    }

    async countDocuments(query = {}) {
        const results = await this.find(query);
        return results.length;
    }
}

// Dynamic Model Proxy Class (evaluates DB choice at execution time)
class DynamicModel {
    constructor(name, schemaObj) {
        this.name = name;
        this.schemaObj = schemaObj;
        this.mongooseModel = null;
        this.jsondbModel = null;
    }

    _getModel() {
        if (useFallback) {
            if (!this.jsondbModel) {
                this.jsondbModel = new JSONDBModel(this.name);
            }
            return this.jsondbModel;
        } else {
            if (!this.mongooseModel) {
                try {
                    if (mongoose.models[this.name]) {
                        this.mongooseModel = mongoose.models[this.name];
                    } else {
                        const schema = new mongoose.Schema(this.schemaObj, { timestamps: true });
                        this.mongooseModel = mongoose.model(this.name, schema);
                    }
                } catch (e) {
                    console.log(`=> DynamicModel compile failed for ${this.name}: ${e.message}`);
                    this.jsondbModel = new JSONDBModel(this.name);
                    return this.jsondbModel;
                }
            }
            return this.mongooseModel;
        }
    }

    async find(query = {}) {
        return this._getModel().find(query);
    }

    async findOne(query = {}) {
        return this._getModel().findOne(query);
    }

    async findById(id) {
        return this._getModel().findById(id);
    }

    async create(data) {
        return this._getModel().create(data);
    }

    async findByIdAndUpdate(id, update, options = {}) {
        return this._getModel().findByIdAndUpdate(id, update, options);
    }

    async deleteOne(query = {}) {
        return this._getModel().deleteOne(query);
    }

    async countDocuments(query = {}) {
        return this._getModel().countDocuments(query);
    }
}

export const getModel = (name, schemaObj) => {
    return new DynamicModel(name, schemaObj);
};

export { useFallback };
