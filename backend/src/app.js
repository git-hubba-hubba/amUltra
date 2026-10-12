import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { auth, authenticate } from './auth.js';
import { resources } from './resources.js';
import { intake } from './intake.js';
import { cinema } from './cinema.js';
import { projectAccess } from './project-access.js';
import { jade } from './jade/routes.js';
export const app=express();
app.disable('x-powered-by');
if(process.env.RENDER) app.set('trust proxy', 1);
app.use(helmet({contentSecurityPolicy:{directives:{imgSrc:["'self'",'data:','https:']}}}));
app.use(express.json({limit:'1mb'}));
app.use(cookieParser());
app.use('/api',rateLimit({windowMs:60000,limit:300,standardHeaders:'draft-8',legacyHeaders:false}));
app.use((req,res,next)=> { if(!['GET','HEAD','OPTIONS'].includes(req.method)) { const origin=req.get('origin'); const allowed=(process.env.APP_ORIGIN||process.env.RENDER_EXTERNAL_URL||'http://localhost:5173').split(',').map(value=>value.trim()); if(origin && !allowed.includes(origin)) return res.status(403).json({error:'Origin not allowed'}); if(req.get('sec-fetch-site')==='cross-site') return res.status(403).json({error:'Cross-site request denied'}); } next(); });
app.get('/api/health',(req,res)=>res.json({ok:true}));
app.use('/api/auth',auth);
app.use('/api/jade', authenticate, jade);
app.use('/api',authenticate,projectAccess,intake,cinema,resources);
const frontendDist=fileURLToPath(new URL('../../frontend/amethyst2/dist/',import.meta.url));
if(process.env.NODE_ENV==='production' && existsSync(frontendDist)) {
 app.use(express.static(frontendDist));
 app.get('/{*path}',(req,res,next)=> {
  if(req.path==='/api' || req.path.startsWith('/api/')) return next();
  res.sendFile('index.html',{root:frontendDist});
 });
}
app.use((req,res)=>res.status(404).json({error:'Endpoint not found'}));
app.use((error,req,res,next)=> { if(res.headersSent)return next(error); let status=error.status||500; if(['ValidationError','CastError','StrictModeError'].includes(error.name))status=400;if(error.name==='VersionError'||error.code===11000)status=409;if(error.code==='LIMIT_FILE_SIZE')status=413;const message=error.code===11000?'This record already exists':error.name==='VersionError'?'Record changed; refresh and retry':status===500?'The operation failed. Please retry.':error.message; if(status===500)console.error(error);res.status(status).json({error:message}); });
