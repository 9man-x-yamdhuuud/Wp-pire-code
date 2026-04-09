const express = require('express');
const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve HTML page
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>WhatsApp Pair Code</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body{background:#0a0a0a;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:system-ui;margin:0;padding:20px;}
        .card{background:#1a1a1a;border-radius:28px;padding:40px 32px;max-width:460px;width:100%;border:1px solid #ff6b00;}
        h1{color:#ff6b00;text-align:center;font-size:28px;margin-bottom:8px;}
        .sub{color:#888;text-align:center;font-size:14px;margin-bottom:32px;}
        input{width:100%;padding:16px;background:#2a2a2a;border:1px solid #333;border-radius:16px;color:white;font-size:16px;margin-bottom:20px;box-sizing:border-box;}
        input:focus{outline:none;border-color:#ff6b00;}
        button{width:100%;padding:16px;background:#ff6b00;border:none;border-radius:16px;color:white;font-size:16px;font-weight:600;cursor:pointer;}
        button:hover{background:#ff8c00;}
        .code-box{font-size:32px;text-align:center;letter-spacing:8px;color:#ff6b00;background:#2a2a2a;padding:24px;border-radius:20px;margin:20px 0;font-family:monospace;word-break:break-all;}
        .timer{text-align:center;color:#ff6b00;font-size:14px;margin:15px 0;}
        .hidden{display:none;}
        .loader{text-align:center;padding:40px;color:#ff6b00;}
        .error{color:#ff4444;text-align:center;margin-top:20px;}
        .note{text-align:center;font-size:12px;color:#555;margin-top:24px;}
        .btn-outline{background:#333;margin-top:10px;}
        .spinner{width:40px;height:40px;border:3px solid #333;border-top-color:#ff6b00;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 15px;}
        @keyframes spin{to{transform:rotate(360deg);}}
    </style>
</head>
<body>
    <div class="card">
        <h1>✨ WhatsApp Pair Code</h1>
        <div class="sub">Connect without scanning QR</div>
        
        <div id="step1">
            <input type="tel" id="phone" placeholder="Enter WhatsApp number (e.g., 9876543210)">
            <button onclick="generateCode()">Generate Pairing Code</button>
            <div class="note">Code valid for 10 minutes</div>
        </div>
        
        <div id="step2" class="hidden">
            <div class="code-box" id="pairingCode">---- ----</div>
            <div class="timer" id="timer">10:00 remaining</div>
            <button onclick="copyCode()">📋 Copy Code</button>
            <button onclick="reset()" class="btn-outline">🔄 New Code</button>
            <div class="note">Open WhatsApp → Settings → Linked Devices → Link with Phone Number</div>
        </div>
        
        <div id="loading" class="hidden">
            <div class="loader"><div class="spinner"></div>Requesting pairing code...</div>
        </div>
        
        <div id="error" class="hidden">
            <div class="error" id="errorMsg"></div>
            <button onclick="reset()" style="margin-top:20px;">Try Again</button>
        </div>
    </div>

    <script>
        let timerInterval = null;
        let currentSession = null;

        async function generateCode() {
            let phone = document.getElementById('phone').value.trim();
            if (!phone) {
                alert('Please enter your phone number');
                return;
            }
            phone = phone.replace(/\\D/g, '');
            if (phone.length < 10) {
                alert('Please enter a valid phone number (10-15 digits)');
                return;
            }

            document.getElementById('step1').classList.add('hidden');
            document.getElementById('step2').classList.add('hidden');
            document.getElementById('error').classList.add('hidden');
            document.getElementById('loading').classList.remove('hidden');

            try {
                const response = await fetch('/api/request-pairing', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber: phone })
                });
                
                const data = await response.json();
                
                if (!response.ok) throw new Error(data.error || 'Failed to generate code');
                
                document.getElementById('pairingCode').innerHTML = data.pairingCode;
                document.getElementById('loading').classList.add('hidden');
                document.getElementById('step2').classList.remove('hidden');
                
                let timeLeft = data.expiresIn;
                const timerEl = document.getElementById('timer');
                
                if (timerInterval) clearInterval(timerInterval);
                timerInterval = setInterval(() => {
                    timeLeft--;
                    const mins = Math.floor(timeLeft / 60);
                    const secs = timeLeft % 60;
                    timerEl.innerHTML = \`\${mins.toString().padStart(2, '0')}:\${secs.toString().padStart(2, '0')} remaining\`;
                    if (timeLeft <= 0) {
                        clearInterval(timerInterval);
                        alert('Code expired. Generate a new one.');
                        reset();
                    }
                }, 1000);
                
                navigator.clipboard.writeText(data.pairingCode);
                
            } catch (err) {
                document.getElementById('loading').classList.add('hidden');
                document.getElementById('errorMsg').innerHTML = err.message;
                document.getElementById('error').classList.remove('hidden');
            }
        }

        function copyCode() {
            const code = document.getElementById('pairingCode').innerHTML;
            navigator.clipboard.writeText(code);
            alert('✅ Code copied!');
        }

        function reset() {
            if (timerInterval) clearInterval(timerInterval);
            document.getElementById('step1').classList.remove('hidden');
            document.getElementById('step2').classList.add('hidden');
            document.getElementById('loading').classList.add('hidden');
            document.getElementById('error').classList.add('hidden');
            document.getElementById('phone').value = '';
        }
    </script>
</body>
</html>
    `);
});

// API endpoint for pairing
app.post('/api/request-pairing', async (req, res) => {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number required' });
    }

    const cleanNum = phoneNumber.toString().replace(/\D/g, '');
    
    if (cleanNum.length < 10 || cleanNum.length > 15) {
        return res.status(400).json({ error: 'Invalid phone number format' });
    }
    
    const sessionId = Date.now().toString();
    const authDir = path.join('/tmp', `auth_${sessionId}`);
    
    try {
        fs.mkdirSync(authDir, { recursive: true });
        
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            browser: ['WhatsApp Pair Tool', 'Chrome', '1.0.0'],
            connectTimeoutMs: 30000,
            defaultQueryTimeoutMs: 30000,
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('connection.update', (update) => {
            const { connection } = update;
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
                    } catch(e) {}
                }, 610000);
                
            } catch(err) {
                console.error('Pairing error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Pairing failed: ' + err.message });
                }
                fs.rmSync(authDir, { recursive: true, force: true });
            }
        }, 1000);
        
    } catch(err) {
        console.error('Session error:', err);
        res.status(500).json({ error: err.message });
        if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
        }
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
