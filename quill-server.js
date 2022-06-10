require('dotenv').config();
const redisPackage = require('redis');
const redis = redisPackage.createClient();

exports.redisClient = redis;

redis.on('connect', function() {

    console.log('Redis Connected!');
});

redis.connect();


const io = require('socket.io')(process.env.QUILL_SERVER_PORT, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const mongoose = require('mongoose');
const Document = require('./Document');

// Use in-memory version of document instead of mongoose (using quill-delta??)
// Detect when everyone has left the room and store the composed document in Mongoose and delete in-memory version
// When someone enters the room:
    // if in-memory version exists send it; else retrieve from Mongoose, set in-memory, send it
// Convert image uploads to S3 saved images
// Set a hard limit on document size, and do not update document once limit has been reached
// Add authentication


mongoose.connect('mongodb://localhost/google-docs-clone');
const defaultValue = '';


io.on("connection", socket => {
    
    socket.on('get-document', async documentId => {
        const document = await findOrCreateDocument(documentId);

        socket.join(documentId);
        socket.emit('load-document', document.data);

        socket.on('send-changes', delta => {
            console.log('on send-changes');
            socket.broadcast.to(documentId).emit("receive-changes", delta);
            socket.emit('receivedDelta', delta)
        })

        socket.on("save-document", async data => {
            await Document.findByIdAndUpdate(documentId, { data: data});
        });
    })
});

async function findOrCreateDocument(id) {
    if (id == null) return;

    const document = await Document.findById(id)


    if (document) return document;

    return await Document.create({ _id: id, data: defaultValue})
}
