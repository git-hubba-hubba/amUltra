import mongoose from 'mongoose';
import { User } from './models.js';
import { hashPassword } from './auth.js';
if(!process.env.MONGODB_URI || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length<12) throw new Error('Set MONGODB_URI, ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters)');
await mongoose.connect(process.env.MONGODB_URI);
if(await User.exists({ email: process.env.ADMIN_EMAIL.toLowerCase() })) throw new Error('Account already exists; bootstrap will not overwrite it');
await User.create({name:process.env.ADMIN_NAME || 'Department Admin',email:process.env.ADMIN_EMAIL.toLowerCase(),passwordHash:hashPassword(process.env.ADMIN_PASSWORD),department:'*',organization:process.env.ORGANIZATION || 'amethyst',role:'admin',status:'active'});
console.log('Administrator created. Remove ADMIN_PASSWORD from .env after bootstrap.');
await mongoose.disconnect();
