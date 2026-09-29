import mongoose from 'mongoose';
import { app } from './app.js';
if(!process.env.MONGODB_URI)throw new Error('MONGODB_URI is required. Copy .env.example to .env and configure MongoDB.');
await mongoose.connect(process.env.MONGODB_URI);
const server=app.listen(Number(process.env.PORT)||4000,()=>console.log('Amethyst API listening on port',Number(process.env.PORT)||4000));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await mongoose.disconnect();process.exit(0)}));
