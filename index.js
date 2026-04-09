const express = require('express');
const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const sessions = new Map();

app.post('/request-pairing', async (req, res) => {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number required' });
    }

    const cleanNum = phoneNumber.toString().replace(/\D/g, '');
    const sessionId = Date.now().toString();
    const authDir = path.join(__dirname, `auth_${sessionId}`);
    
    try {
        fs.mkdirSync(authDir, { recursive: true });
        
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            browser: ['WhatsApp Pair Tool', 'Chrome', '1.0.0'],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            markOnlineOnConnect: false,
        });
        
        sessions.set(sessionId, { sock, authDir });
        
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'open') {
                console.log('Connected for:', cleanNum);
            }
        });
        
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(cleanNum);
                const formattedCode = code.match(/.{1,4}/g).join('-');
                res.json({ 
                    success: true, 
                    sessionId, 
                    pairingCode: formattedCode, 
                    expiresIn: 600 
                });
                
                setTimeout(async () => {
                    try {
                        await sock.logout();
                        fs.rmSync(authDir, { recursive: true, force: true });
                        sessions.delete(sessionId);
                    } catch(e) {}
                }, 610000);
                
            } catch(err) {
                res.status(500).json({ error: 'Pairing failed: ' + err.message });
                fs.rmSync(authDir, { recursive: true, force: true });
                sessions.delete(sessionId);
            }
        }, 1000);
        
    } catch(err) {
        res.status(500).json({ error: err.message });
        if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
        }
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
