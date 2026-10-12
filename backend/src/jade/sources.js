import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { parse } from 'csv-parse/sync';
import ffmpegPath from 'ffmpeg-static';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { HttpError, requireValue } from '../policy.js';
const exec = promisify(execFile);
const media = new Set(['.mp3', '.wav', '.m4a', '.mp4', '.mov', '.webm']);
const videos = new Set(['.mp4', '.mov', '.webm']);
const imageMimes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
export const acceptedExtensions = '.pdf,.docx,.txt,.md,.csv,.xlsx,.vtt,.srt,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.m4a,.mp4,.mov,.webm';
export async function mediaStatus() {
  try { await access(process.env.JADE_FFMPEG_PATH || ffmpegPath); return true; } catch { return false; }
}
export function validateUpload(file) {
  const extension = extname(file.originalname).toLowerCase();
  requireValue(acceptedExtensions.split(',').includes(extension), `Unsupported file: ${file.originalname}`);
  requireValue(file.buffer.length > 0, 'Empty files cannot be processed');
  if (media.has(extension)) {
    requireValue(process.env.JADE_TRANSCRIPTION_URL, 'Audio/video requires JADE_TRANSCRIPTION_URL and JADE_TRANSCRIPTION_MODEL configuration.', 503);
    requireValue(process.env.JADE_TRANSCRIPTION_MODEL, 'Set JADE_TRANSCRIPTION_MODEL for audio/video.', 503);
  }
  if (extension === '.pdf') requireValue(file.buffer.subarray(0, 5).toString() === '%PDF-', 'Invalid PDF file');
}
export async function prepareSource(source) {
  if (source.text || source.kind === 'pdf' || source.kind === 'image') return;
  const extension = extname(source.name).toLowerCase();
  const bytes = source.bytes;
  if (extension === '.pdf') { source.kind = 'pdf'; source.mime = 'application/pdf'; return; }
  if (imageMimes[extension]) { source.kind = 'image'; source.mime = imageMimes[extension]; return; }
  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer: bytes });
    source.text = result.value;
    source.coverage = result.messages.length ? 'DOCX text extracted; embedded images and layout are not analyzed.' : 'DOCX text; embedded images and layout are not analyzed.';
  } else if (extension === '.xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    let count = 0;
    const lines = [];
    for (const sheet of workbook.worksheets) {
      for (let index = 1; index <= sheet.rowCount; index++) {
        requireValue(++count <= 5000, 'Spreadsheet exceeds the 5000-row limit.');
        const values = sheet.getRow(index).values.slice(1).map(value => {
          if (value instanceof Date) return value.toISOString();
          if (value && typeof value === 'object') return value.text ?? value.result ?? value.richText?.map(part => part.text).join('') ?? JSON.stringify(value);
          return value ?? '';
        });
        lines.push(`${sheet.name} row ${index}: ${JSON.stringify(values)}`);
      }
    }
    source.text = lines.join('\n');
    source.coverage = 'All worksheet rows; formulas use stored results and are not recalculated.';
  } else if (extension === '.csv') {
    const rows = parse(bytes.toString('utf8'), { bom: true, relax_column_count: true });
    requireValue(rows.length <= 5000, 'CSV exceeds the 5000-row limit.');
    source.text = rows.map((row, index) => `row ${index + 1}: ${JSON.stringify(row)}`).join('\n');
  } else if (media.has(extension)) {
    await prepareMedia(source, extension);
  } else {
    source.text = bytes.toString('utf8').split(/\r?\n/).map((line, index) => `line ${index + 1}: ${line}`).join('\n');
  }
  requireValue(source.text?.trim(), `No readable text was found in ${source.name}.`);
  requireValue(source.text.length <= 300000, 'Extracted text exceeds 300,000 characters; split the source into smaller files.');
  source.kind = media.has(extension) ? 'media' : 'text';
}
async function prepareMedia(source, extension) {
  const executable = process.env.JADE_FFMPEG_PATH || ffmpegPath;
  requireValue(await mediaStatus(), 'FFmpeg is unavailable. Install ffmpeg-static scripts or set JADE_FFMPEG_PATH.', 503);
  const directory = await mkdtemp(join(tmpdir(), 'jade-media-'));
  try {
    const input = join(directory, `input${extension}`);
    await writeFile(input, source.bytes);
    let metadata = '';
    try { await exec(executable, ['-hide_banner', '-protocol_whitelist', 'file,pipe', '-i', input], { timeout: 15000 }); }
    catch (error) { metadata = error.stderr || ''; }
    const durationMatch = metadata.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    requireValue(durationMatch, 'Media duration could not be determined; upload a standard media file.');
    const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
    requireValue(duration > 0 && duration <= 600, 'Media must be at most 10 minutes. Split longer recordings before upload.');
    const args = ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-i', input];
    const hasAudio = /Audio:/.test(metadata);
    if (hasAudio) {
    await exec(executable, [...args, '-vn', '-ac', '1', '-ar', '16000', join(directory, 'audio.wav')], { timeout: 120000, maxBuffer: 1024 * 1024 });
    const audio = await readFile(join(directory, 'audio.wav'));
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', process.env.JADE_TRANSCRIPTION_MODEL);
    form.append('response_format', 'json');
    const endpoint = new URL(process.env.JADE_TRANSCRIPTION_URL);
    requireValue(endpoint.protocol === 'https:' || endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1', 'Transcription endpoint must use HTTPS or localhost.');
    const response = await fetch(endpoint, { method: 'POST', body: form, signal: AbortSignal.timeout(180000),
      headers: process.env.JADE_TRANSCRIPTION_KEY ? { Authorization: `Bearer ${process.env.JADE_TRANSCRIPTION_KEY}` } : {},
    });
    if (!response.ok) throw new HttpError(503, `Transcription failed (HTTP ${response.status}).`);
    const result = await response.json();
    requireValue(typeof result.text === 'string', 'Transcription provider did not return text.');
    source.text = result.text;
    source.coverage = `Audio transcribed (${duration.toFixed(1)} seconds); transcription may contain errors.`;
    } else {
      requireValue(videos.has(extension), 'No audio track was found.');
      source.text = 'This video has no audio track. Only sampled visual frames are available.';
      source.coverage = `Silent video (${duration.toFixed(1)} seconds).`;
    }
    if (videos.has(extension)) {
      await exec(executable, [...args, '-an', '-vf', `fps=${Math.min(1, 20 / duration)},scale=1024:-1`, '-frames:v', '20', join(directory, 'frame-%02d.jpg')], { timeout: 120000, maxBuffer: 1024 * 1024 });
      const frames = (await readdir(directory)).filter(name => name.startsWith('frame-')).sort();
      source.frames = await Promise.all(frames.map(async name => (await readFile(join(directory, name))).toString('base64')));
      source.coverage += ` Video sampled across its duration at approximately ${Math.max(1, duration / 20).toFixed(1)}-second intervals, at most 20 frames; unsampled scenes are not analyzed.`;
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export function sourceBlocks(sources) {
  return sources.flatMap(source => {
    const label = { type: 'text', text: `SOURCE ${source.sourceId}: ${source.name}; purpose=${source.purpose}; coverage=${source.coverage || 'Full supplied file'}` };
    if (source.kind === 'pdf') return [label, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: source.bytes.toString('base64') } }];
    if (source.kind === 'image') return [label, { type: 'image', source: { type: 'base64', media_type: source.mime, data: source.bytes.toString('base64') } }];
    return [label, { type: 'text', text: source.text }, ...(source.frames || []).flatMap((frame, index) => [
      { type: 'text', text: `${source.sourceId} sampled video frame ${index + 1}; see coverage for the approximate sampling interval` },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: frame } },
    ])];
  });
}
