const { S3, AbortMultipartUploadCommand, CreateBucketCommand, ListBucketsCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const redisPackage = require('redis');
const { v4: uuidv4 } = require('uuid');

require('dotenv').config();

var fs = require('fs');

var serverOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/google-docs-clone.appgalleria.com/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/google-docs-clone.appgalleria.com/fullchain.pem')
};

var app = require('https').createServer(serverOptions);

const io = require('socket.io')(app, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 1e8
});
app.listen(process.env.QUILL_SERVER_PORT);


const redis = redisPackage.createClient({
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    }
});
exports.redisClient = redis;

const options = {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    credentials: {
      accessKeyId: process.env.S3_KEY,
      secretAccessKey: process.env.S3_SECRET
    }
}

console.log('options', options);

const s3Client = new S3(options);

const Bucket = process.env.S3_BUCKET;
const ContentType = 'image';
const expiresIn = 900;

const getPutSignedUrl = async (Key) => {
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



const Document = require('./Document');
const defaultValue = '';

io.on("connection", socket => {
    console.log(`${socket.id} connected`);

    socket.on('getInitialDocument', async (documentId, token = null, permissions = []) => {
        console.log('on getInitialDocument')
        
        let deltas = await redis.lRange(documentId, 0, -1);
        console.log('deltas', deltas);

        socket.join(documentId);
        
        io.to(socket.id).emit('getInitialDocument', deltas);
    })

    socket.on('newDelta', async (documentId, delta, expectedIndex, token = null, permissions = []) => {
        console.log('on newDelta', documentId, delta, expectedIndex);

        const actualIndex = await redis.rPush(documentId, JSON.stringify(delta));
        console.log(`expectedIndex: ${expectedIndex} — actualIndex: ${actualIndex}`);

        io.to(documentId).emit("newDelta", delta, actualIndex+1, socket.id);
        
        if (actualIndex === expectedIndex) return;

        let deltas = await redis.lRange(documentId, 0, -1);
        io.to(socket.id).emit('getInitialDocument', deltas);
        

    });

    socket.on('disconnect', () => {
        console.log(`${socket.id} has disconnected.`);
    })
    


    socket.on('get-upload-url', async (signatureData, documentId) => {
        console.log ('on get-upload-url', signatureData)
        let result = [];
        for (let i = 0; i < signatureData.length; ++i) {
            const fileName = `${documentId}/${uuidv4()}.${signatureData[i].extension}`;
            const url = await getPutSignedUrl(fileName);
            result.push({
                path: signatureData[i].path,
                fileName,
                url
            })
        }
        console.log('emit get-upload-url', result);
        io.to(socket.id).emit('get-upload-url', result);
    });

    
});
