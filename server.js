// Create a file env.js
// Create three const vars named JWT_SECRET, PEXELS_API_KEY, HF_API_TOKEN
// Provide the keys in "api_key"
//Also create a folder in public named videos so path will look like /public/videos

// The env.js should be in the below format:
// const JWT_SECRET = "api_placeholder"
// const PEXELS_API_KEY = "api_placeholder"
// const HF_API_TOKEN = "api_placeholder";
// module.exports = { JWT_SECRET, PEXELS_API_KEY, HF_API_TOKEN };

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { JWT_SECRET, PEXELS_API_KEY, HF_API_TOKEN } = require("./env.js");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const db = new sqlite3.Database('database.db', (err) => {
    if (err) console.error(err.message);
    console.log('Connected to SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )`);
});

app.post('/api/register', async (req, res) => {
    const { email, password, confirmPassword } = req.body;
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({
            message: 'Password must be at least 8 characters long and contain letters, numbers, and special characters (@$!%*#?&).'
        });
    }
    if (password !== confirmPassword) {
        return res.status(400).json({ message: 'Passwords do not match!' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword], (err) => {
            if (err) return res.status(400).json({ message: 'Email already exists!' });
            res.status(201).json({ message: 'Registration successful! Please login.' });
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err || !user) return res.status(400).json({ message: 'Invalid email or password!' });

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.status(400).json({ message: 'Invalid email or password!' });

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    });
});

const authenticateToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ message: 'Access denied. No token provided.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token.' });
        req.user = user;
        next();
    });
};

app.get('/api/home', authenticateToken, (req, res) => {
    res.json({ message: 'Welcome to VisionX!' });
});

app.post('/api/logout', authenticateToken, (req, res) => {
    res.json({ message: 'Logged out successfully.' });
});

app.post('/api/fetch-video', authenticateToken, async (req, res) => {
    const { keyword } = req.body;
    if (!keyword) {
        return res.status(400).json({ message: 'Keyword is required.' });
    }

    try {
        const words = keyword.split(' ');
        const queries = [words.join('+'), words.reverse().join('+')];
        let videoUrl = null;

        for (const query of queries) {
            const url = `https://api.pexels.com/videos/search?query=${query}&per_page=5`;
            const response = await fetch(url, {
                headers: { "Authorization": PEXELS_API_KEY }
            });
            if (!response.ok) throw new Error(`Pexels API error: ${response.statusText}`);
            const data = await response.json();

            if (data.videos && data.videos.length > 0) {
                const longestVideo = data.videos.reduce((max, vid) => max.duration > vid.duration ? max : vid);
                videoUrl = longestVideo.video_files[0].link;
                break;
            }
        }

        if (!videoUrl) {
            return res.status(404).json({ message: 'No video found for the given keyword.' });
        }

        const videoPath = `public/videos/${keyword.replace(' ', '_')}.mp4`;
        const videoResponse = await fetch(videoUrl);
        if (!videoResponse.ok) throw new Error(`Failed to fetch video: ${videoResponse.statusText}`);

        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
        await fs.writeFile(videoPath, videoBuffer);

        res.json({ videoPath: `/videos/${keyword.replace(' ', '_')}.mp4` });
    } catch (error) {
        console.error('Error in fetch-video:', error.message);
        res.status(500).json({ message: 'Error fetching video: ' + error.message });
    }
});

app.post('/api/download-video', authenticateToken, async (req, res) => {
    const { videoPath, format } = req.body;
    if (!videoPath || !format) {
        return res.status(400).json({ message: 'Video path and format are required.' });
    }

    const supportedFormats = ['mp4', 'avi', 'webm', 'mkv']; 
    if (!supportedFormats.includes(format)) {
        return res.status(400).json({ message: 'Unsupported format. Use mp4, avi, webm, or mkv.' });
    }

    try {
        const inputFile = path.join(__dirname, 'public', videoPath.replace(/^\/videos\//, 'videos/'));
        const outputFormat = format === 'mkv' ? 'matroska' : format; 
        const outputFile = path.join(__dirname, 'public/videos', `${path.basename(videoPath, '.mp4')}_${format}.${format}`);

        try {
            await fs.access(inputFile, fsSync.constants.F_OK);
        } catch (err) {
            return res.status(404).json({ message: 'Video file not found.' });
        }

        await new Promise((resolve, reject) => {
            ffmpeg(inputFile)
                .outputOptions('-f', outputFormat) 
                .output(outputFile)
                .on('end', resolve)
                .on('error', (err) => reject(new Error('Conversion failed: ' + err.message)))
                .run();
        });

        res.download(outputFile, `${path.basename(videoPath, '.mp4')}.${format}`, async (err) => {
            if (!err) {
                try {
                    await fs.unlink(outputFile); 
                } catch (cleanupErr) {
                    console.error('Error cleaning up file:', cleanupErr);
                }
            } else {
                console.error('Download error:', err);
            }
        });
    } catch (error) {
        console.error('Error in download-video:', error);
        res.status(500).json({ message: 'Error processing download: ' + error.message });
    }
});

app.post('/api/chatbot', authenticateToken, async (req, res) => {
    const { userInput } = req.body;
    if (!userInput) {
        return res.status(400).json({ message: 'Input is required.' });
    }

    try {
        const API_URL = "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2";
        const headers = {
            "Authorization": `Bearer ${HF_API_TOKEN}`,
            "Content-Type": "application/json"
        };
        const payload = {
            "inputs": `<s>[INST] ${userInput} [/INST]`,
            "parameters": {
                "max_new_tokens": 500,
                "temperature": 0.7,
                "top_p": 0.95,
                "do_sample": true
            }
        };

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (response.status === 200) {
            const data = await response.json();
            const result = data[0].generated_text;
            const answer = result.split("[/INST]")[1].trim();
            res.json({ response: answer });
        } else {
            const errorText = await response.text();
            res.status(500).json({ message: `Error: ${response.status} - ${errorText}` });
        }
    } catch (error) {
        res.status(500).json({ message: `Error: ${error.message}` });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});