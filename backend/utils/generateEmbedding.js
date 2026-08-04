const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
dotenv.config({ path: '../config/.env' });

const generateEmbedding = async (text) => {
    try {
        if (!process.env.GEMINI_API_KEY) {
            console.warn('⚠️ GEMINI_API_KEY not set — skipping embedding generation.');
            return null;
        }
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

        const result = await model.embedContent(text);
        return result.embedding.values;
    } catch (error) {
        console.error('Embedding Generation Error:', error.message);
        return null;
    }
};

module.exports = { generateEmbedding };
