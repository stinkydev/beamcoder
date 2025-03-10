/*
  Aerostat Beam Coder - Node.js native bindings to FFmpeg.
  Copyright (C) 2019  Streampunk Media Ltd.

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <https://www.gnu.org/licenses/>.

  https://www.streampunk.media/ mailto:furnace@streampunk.media
  14 Ormiscaig, Aultbea, Achnasheen, IV22 2JJ  U.K.
*/

const os = require('os');
const fs = require('fs');
const util = require('util');
const https = require('https');
const cp = require('child_process');
const [ mkdir, access, rename, execFile, exec ] = // eslint-disable-line
  [ fs.mkdir, fs.access, fs.rename, cp.execFile, cp.exec ].map(util.promisify);

async function get(ws, url, name) {
  let received = 0;
  let totalLength = 0;
  return new Promise((comp, err) => {
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        err({ name: 'RedirectError', message: res.headers.location });
      } else {
        res.pipe(ws);
        if (totalLength == 0) {
          totalLength = +res.headers['content-length'];
        }
        res.on('end', () => {
          process.stdout.write(`Downloaded 100% of '${name}'. Total length ${received} bytes.\n`);
          comp();
        });
        res.on('error', err);
        res.on('data', x => {
          received += x.length;
          process.stdout.write(`Downloaded ${received * 100/ totalLength | 0 }% of '${name}'.\r`);
        });
      }
    }).on('error', err);
  });
}

async function getHTML(url, name) {
  let received = 0;
  let totalLength = 0;
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      if (totalLength == 0) {
        totalLength = +res.headers['content-length'];
      }
      res.on('end', () => {
        process.stdout.write(`Downloaded 100% of '${name}'. Total length ${received} bytes.\n`);
        resolve(Buffer.concat(chunks));
      });
      res.on('error', reject);
      res.on('data', (chunk) => {
        chunks.push(chunk);
        received += chunk.length;
        process.stdout.write(`Downloaded ${received * 100/ totalLength | 0 }% of '${name}'.\r`);
      });
    }).on('error', reject);
  });
}

async function unzipFile(archiveName, destFolder) {
  const yauzl = require('yauzl');
  const path = require('path');

  let rootPath = '';
  
  if (!fs.existsSync(destFolder)){
    fs.mkdirSync(destFolder);
  }

  console.log(`Unzipping '${archiveName}' to '${destFolder}'.`);
  return new Promise((resolve, reject) => {
    let handles = 0;
    function decHandles() {
      handles--;
      if (handles === 0) {
        console.log(`Unzipping of '${archiveName}' completed.`);
        resolve(rootPath);
      }
    }

    function incHandles() {
      handles++;
    }
    
    try {
      incHandles();

      yauzl.open(archiveName, { lazyEntries: true }, (err, zipfile) => {
        if (err) reject(err);
        zipfile.readEntry();
        zipfile.on('entry', (entry) => {
          if (/\/$/.test(entry.fileName)) {
            // Directory file names end with '/'.
            // Note that entries for directories themselves are optional.
            // An entry's fileName implicitly requires its parent directories to exist.
            zipfile.readEntry();
          } else {
            // file entry
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) reject(err);
              readStream.on('end', () => {
                zipfile.readEntry();
              });

              const destPath = path.join(destFolder, entry.fileName);
              if (rootPath === '') {
                rootPath = entry.fileName.split('/')[0];
              }

              if (!fs.existsSync(path.dirname(destPath))) {
                fs.mkdirSync(path.dirname(destPath), { recursive: true });
              }

              incHandles();
              const writeFileStream = fs.createWriteStream(destPath);
              writeFileStream.on('close', () => {
                decHandles();
              });
              readStream.pipe(writeFileStream);
            });
          }
        });
        zipfile.on('end', () => {
          decHandles();
        });
      });
    } catch (err) {
      reject(new Error(`Error unzipping ${archiveName}: ${err.message}`));
    }
  });
}

async function win32() {
  console.log('Checking/Installing FFmpeg dependencies for Beam Coder on Windows.');

  await mkdir('ffmpeg').catch(e => {
    if (e.code === 'EEXIST') return;
    else throw e;
  });
  
  const ffmpegFilename = 'ffmpeg-5.x-win64-shared';
  const url = 'https://github.com/GyanD/codexffmpeg/releases/download/5.1.2/ffmpeg-5.1.2-full_build-shared.zip';

  await access(`ffmpeg/${ffmpegFilename}`, fs.constants.R_OK).catch(async () => {
    let ws_shared = fs.createWriteStream(`ffmpeg/${ffmpegFilename}.zip`);
    await get(ws_shared, url, `${ffmpegFilename}.zip`)
      .catch(async (err) => {
        if (err.name === 'RedirectError') {
          const redirectURL = err.message;
          await get(ws_shared, redirectURL, `${ffmpegFilename}.zip`);
        } else console.error(err);
      });

    await exec('npm install yauzl --no-save');
    const root = await unzipFile(`ffmpeg/${ffmpegFilename}.zip`, 'ffmpeg');
    fs.renameSync(`ffmpeg/${root}`, `ffmpeg/${ffmpegFilename}`);
  });
}

async function linux() {
  console.log('Checking FFmpeg dependencies for Beam Coder on Linux.');
  const { stdout } = await execFile('ldconfig', ['-p']).catch(console.error);
  let result = 0;

  if (stdout.indexOf('libavcodec.so.59') < 0) {
    console.error('libavcodec.so.59 is not installed.');
    result = 1;
  }
  if (stdout.indexOf('libavformat.so.59') < 0) {
    console.error('libavformat.so.59 is not installed.');
    result = 1;
  }
  if (stdout.indexOf('libavdevice.so.59') < 0) {
    console.error('libavdevice.so.59 is not installed.');
    result = 1;
  }
  if (stdout.indexOf('libavfilter.so.8') < 0) {
    console.error('libavfilter.so.8 is not installed.');
    result = 1;
  }
  if (stdout.indexOf('libavutil.so.57') < 0) {
    console.error('libavutil.so.57 is not installed.');
    result = 1;
  }
  if (stdout.indexOf('libpostproc.so.56') < 0) {
    console.error('libpostproc.so.56 is not installed.');
    result = 1;
  }
  if (stdout.indexOf('libswresample.so.4') < 0) {
    console.error('libswresample.so.4 is not installed.');
    result = 1;
  }
  if (stdout.indexOf('libswscale.so.6') < 0) {
    console.error('libswscale.so.6 is not installed.');
    result = 1;
  }

  if (result === 1) {
    console.log(`Try running the following (Ubuntu/Debian):
sudo add-apt-repository ppa:jonathonf/ffmpeg-4
sudo apt-get install libavcodec-dev libavformat-dev libavdevice-dev libavfilter-dev libavutil-dev libpostproc-dev libswresample-dev libswscale-dev`);
    process.exit(1);
  }
  return result;
}

async function darwin() {
  console.log('Checking for FFmpeg dependencies via HomeBrew.');
  let output;
  let returnMessage;
  
  try {
    output = await exec('brew list ffmpeg@5');
    returnMessage = 'FFmpeg already present via Homebrew.';
  } catch (err) {
    if (err.stderr.indexOf('Error: No such keg') === -1 && err.stderr.indexOf('ffmpeg@5') === -1) {
      console.error(err);
      console.log('Either Homebrew is not installed or something else is wrong.\nExiting');
      process.exit(1);
    }

    console.log('FFmpeg not installed. Attempting to install via Homebrew.');
    try {
      output = await exec('brew install nasm pkg-config texi2html ffmpeg@5');
      returnMessage = 'FFmpeg installed via Homebrew.';
    } catch (err) {
      console.log('Failed to install ffmpeg:\n');
      console.error(err);
      process.exit(1);
    }
  }

  console.log(output.stdout);
  console.log(returnMessage);

  return 0;
}

switch (os.platform()) {
case 'win32':
  if (os.arch() != 'x64') {
    console.error('Only 64-bit platforms are supported.');
    process.exit(1);
  } else {
    win32().catch(console.error);
  }
  break;
case 'linux':
  if (os.arch() != 'x64' && os.arch() != 'arm64') {
    console.error('Only 64-bit platforms are supported.');
    process.exit(1);
  } else {
    linux();
  }
  break;
case 'darwin':
  if (os.arch() != 'x64' && os.arch() != 'arm64') {
    console.error('Only 64-bit platforms are supported.');
    process.exit(1);
  } else {
    darwin();
  }
  break;
default:
  console.error(`Platfrom ${os.platform()} is not supported.`);
  break;
}
