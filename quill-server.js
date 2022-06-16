const { S3, AbortMultipartUploadCommand, CreateBucketCommand, ListBucketsCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

require('dotenv').config();
const redisPackage = require('redis');

const redis = redisPackage.createClient();
exports.redisClient = redis;

const s3Client = new S3({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    credentials: {
      accessKeyId: process.env.S3_KEY,
      secretAccessKey: process.env.S3_SECRET
    }
});

const Bucket = process.env.S3_BUCKET;

const getPutSignedUrl = async (Key, ContentType, expiresIn = 900) => {
    const bucketParams = {Bucket, Key, ContentType};
  
    try {
      const url = await getSignedUrl(s3Client, new PutObjectCommand({Bucket, Key, ContentType}), { expiresIn }); 
      return url;
    } catch (err) {
      console.log("Error getPutSignedUrl", err);
      return false;
    }
};
  
redis.on('connect', async function() {
    console.log('Redis Connected');
});

redis.connect();


const io = require('socket.io')(process.env.QUILL_SERVER_PORT, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 1e8
});

const mongoose = require('mongoose');
const Document = require('./Document');

// Convert image uploads to S3 saved images
// Detect when everyone has left the room and store the composed document in Mongoose and delete in-memory version
// When someone enters the room:
    // if in-memory version exists send it; else retrieve from Mongoose, set in-memory, send it
// Set a hard limit on document size, and do not update document once limit has been reached
// Add authentication

// User sends delta plus expected index
// Insert delta onto redis list and get the index
// broadcast delta and index to everyone else and exit.
// If the returnedIndex !== expectedIndex send to user the full document as an update


mongoose.connect('mongodb://localhost/google-docs-clone');
const defaultValue = '';

io.on("connection", socket => {
    console.log(`${socket.id} connected`);

    socket.on('getInitialDocument', async (documentId, token = null, permissions = []) => {
        console.log('on getInitialDocument')
        
        let deltas = await redis.lRange(documentId, 0, -1);
        console.log('deltas', deltas);

        socket.join(documentId);
        
        io.to(socket.id).emit('getInitialDocument', deltas);
    
        socket.on('newDelta', async (delta, expectedIndex, token = null, permissions = []) => {
            console.log('on newDelta', documentId, delta, expectedIndex);
            const actualIndex = await redis.rPush(documentId, JSON.stringify(delta));

            socket.to(documentId).emit("newDelta", delta, actualIndex);
            if (actualIndex !== expectedIndex) {
                console.log('resetDocument');

                const list = await redis.lRange(documentId, 0, -1);
                io.to(socket.id).emit('resetDocument',  list);
            }
        })
    })
    
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

    socket.on('get-upload-url', async (fileName, fileType) => {
        const url = getPutSignedUrl(fileName, fileType);
    });
});

async function findOrCreateDocument(documentId) {
    if (documentId == null) return;

    const document = await Document.findById(documentId)

    if (document) return document;

    return await Document.create({ _id: documentId, data: defaultValue})
}
