const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const gtts = require('gtts');
const { Configuration, OpenAIApi } = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// OpenAI Configuration
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY
});
const openai = new OpenAIApi(configuration);

// Temp dosyalar için klasör
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

// 1. Kamera gerekli mi kontrol et
app.post('/api/check-camera', async (req, res) => {
    try {
        const { message } = req.body;
        
        const prompt = `
Kullanıcının şu mesajına bakarak, bu soruyu yanıtlamak için kamera/görüntü gerekli mi?

Kullanıcı mesajı: "${message}"

Sadece "EVET" veya "HAYIR" ile yanıtla.

Kamera gerekli durumlar:
- "Bu nedir?", "Bunlardan hangisini almalıyım?", "Bu nasıl görünüyor?"
- Görsel analiz, nesne tanıma, karşılaştırma gerektiren sorular
- "Dışarıdayım, yardım et" tarzı durum soruları
- Çevremi tanımla, ne görüyorsun gibi sorular

Kamera gereksiz durumlar:
- Genel sorular, matematik, tarih, bilgi soruları
- "Merhaba", "Nasılsın?" gibi sohbet
- Tavsiye isteme (görsel olmayan)
- Saat, hava durumu gibi bilgi soruları
`;

        const response = await openai.createChatCompletion({
            model: 'gpt-4',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 10,
            temperature: 0
        });
        
        const answer = response.data.choices[0].message.content.trim().toUpperCase();
        const needsCamera = answer.includes('EVET');
        
        res.json({ 
            needsCamera: needsCamera,
            reasoning: answer 
        });
        
    } catch (error) {
        console.error('Kamera kontrolü hatası:', error);
        res.status(500).json({ 
            error: 'Kamera kontrolü yapılamadı',
            needsCamera: false 
        });
    }
});

// 2. Normal ChatGPT
app.post('/api/normal-chat', async (req, res) => {
    try {
        const { message } = req.body;
        
        const response = await openai.createChatCompletion({
            model: 'gpt-4',
            messages: [
                {
                    role: 'system',
                    content: 'Sen yardımcı bir Türkçe asistansın. Kısa, net ve faydalı yanıtlar ver.'
                },
                {
                    role: 'user',
                    content: message
                }
            ],
            max_tokens: 500,
            temperature: 0.7
        });
        
        res.json({ 
            response: response.data.choices[0].message.content,
            type: 'normal_chat'
        });
        
    } catch (error) {
        console.error('Normal chat hatası:', error);
        res.status(500).json({ 
            error: 'ChatGPT yanıt veremedi',
            response: 'Üzgünüm, şu anda yanıt veremiyorum.'
        });
    }
});

// 3. Vision ChatGPT
app.post('/api/vision-chat', async (req, res) => {
    try {
        const { message, image } = req.body;
        
        const response = await openai.createChatCompletion({
            model: 'gpt-4-vision-preview',
            messages: [{
                role: 'user',
                content: [
                    { 
                        type: 'text', 
                        text: `Kullanıcı sorusu: ${message}\n\nGörüntüyü analiz et ve Türkçe olarak yardımcı ol. Detaylı ve faydalı bilgi ver.`
                    },
                    { 
                        type: 'image_url', 
                        image_url: { 
                            url: `data:image/jpeg;base64,${image}`,
                            detail: 'high'
                        }
                    }
                ]
            }],
            max_tokens: 500,
            temperature: 0.7
        });
        
        res.json({ 
            response: response.data.choices[0].message.content,
            type: 'vision_chat'
        });
        
    } catch (error) {
        console.error('Vision chat hatası:', error);
        res.status(500).json({ 
            error: 'Görüntü analizi yapılamadı',
            response: 'Görüntü analiz edilemedi. Lütfen tekrar deneyin.'
        });
    }
});

// 4. Text-to-Speech (GTTS)
app.post('/api/text-to-speech', async (req, res) => {
    try {
        const { text, lang = 'tr' } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Metin gerekli' });
        }
        
        // Çok uzun metinleri kısalt
        const maxLength = 500;
        const truncatedText = text.length > maxLength ? 
            text.substring(0, maxLength) + '...' : text;
        
        const tts = new gtts(truncatedText, lang);
        const fileName = `speech_${Date.now()}.mp3`;
        const filePath = path.join(tempDir, fileName);
        
        // GTTS ile ses dosyası oluştur
        tts.save(filePath, (error) => {
            if (error) {
                console.error('GTTS hatası:', error);
                return res.status(500).json({ error: 'Ses oluşturulamadı' });
            }
            
            // Dosyayı gönder
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            
            const fileStream = fs.createReadStream(filePath);
            fileStream.pipe(res);
            
            // Dosyayı gönderildikten sonra sil
            fileStream.on('end', () => {
                setTimeout(() => {
                    fs.unlink(filePath, (err) => {
                        if (err) console.error('Temp dosya silinemedi:', err);
                    });
                }, 1000);
            });
        });
        
    } catch (error) {
        console.error('TTS hatası:', error);
        res.status(500).json({ error: 'Ses oluşturulamadı' });
    }
});

// 5. Sağlık kontrolü
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        services: {
            openai: !!process.env.OPENAI_API_KEY,
            gtts: true
        }
    });
});

// Hata yakalama middleware
app.use((error, req, res, next) => {
    console.error('Sunucu hatası:', error);
    res.status(500).json({ 
        error: 'Sunucu hatası oluştu',
        message: error.message 
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint bulunamadı' });
});

// Sunucuyu başlat
app.listen(PORT, () => {
    console.log(`🚀 Server ${PORT} portunda çalışıyor`);
    console.log(`📱 Frontend: http://localhost:${PORT}`);
    console.log(`🔧 API Health: http://localhost:${PORT}/api/health`);
    
    // Gerekli environment değişkenlerini kontrol et
    if (!process.env.OPENAI_API_KEY) {
        console.warn('⚠️  OPENAI_API_KEY environment değişkeni eksik!');
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Server kapatılıyor...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Server kapatılıyor...');
    process.exit(0);
});