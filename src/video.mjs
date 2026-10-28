import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {randomBytes} from 'node:crypto';
import {exec} from './phone.mjs';
export class JPEGFrames {
 constructor(emit){this.emit=emit;this.buffer=Buffer.alloc(0);}
 push(chunk){this.buffer=Buffer.concat([this.buffer,chunk]);while(true){const start=this.buffer.indexOf(Buffer.from([255,216]));if(start<0){this.buffer=this.buffer.subarray(-1);return;}if(start)this.buffer=this.buffer.subarray(start);const end=this.buffer.indexOf(Buffer.from([255,217]),2);if(end<0){if(this.buffer.length>4*1024*1024)this.buffer=Buffer.alloc(0);return;}this.emit(this.buffer.subarray(0,end+2));this.buffer=this.buffer.subarray(end+2);}}
}
export class LiveVideo {
 constructor(phone){this.phone=phone;this.clients=new Set();this.frame=null;this.frames=0;this.status='idle';this.error='';this.generation=0;}
 info(){return {status:this.status,frames:this.frames,clients:this.clients.size,error:this.error,targetFps:30};}
 subscribe(req,res){
  clearTimeout(this.idleTimer);res.set({'Content-Type':'multipart/x-mixed-replace; boundary=tapio-frame','Cache-Control':'no-store, no-cache','X-Content-Type-Options':'nosniff'});res.flushHeaders();
  const client={res,blocked:false,viewer:String(req.query.viewer || '')};this.clients.add(client);res.on('drain',()=>{client.blocked=false;});req.on('close',()=>{this.clients.delete(client);if(!this.clients.size)this.idleTimer=setTimeout(()=>this.stop(),3000);});
  if(this.frame)this.write(client,this.frame);if(!this.starting && !this.server)this.start();
 }
 unsubscribe(viewer){for(const client of this.clients){if(client.viewer===viewer){this.clients.delete(client);client.res.end();}}if(!this.clients.size){clearTimeout(this.idleTimer);this.idleTimer=setTimeout(()=>this.stop(),3000);}}
 write(client,frame){if(client.blocked || client.res.destroyed)return;const header=Buffer.from(`--tapio-frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);client.blocked=!client.res.write(Buffer.concat([header,frame,Buffer.from('\r\n')]));}
 async start(){
  if(this.starting || this.server)return;const generation=++this.generation;this.starting=true;this.status='starting';this.error='';
  try{
   const scrcpy=process.env.SCRCPY || '/opt/homebrew/bin/scrcpy';const {stdout}=await exec(scrcpy,['--version']);const version=stdout.match(/scrcpy ([\d.]+)/)?.[1];if(!version)throw new Error('Cannot detect installed scrcpy version');
   const jar=process.env.SCRCPY_SERVER || '/opt/homebrew/share/scrcpy/scrcpy-server';const remote='/data/local/tmp/tapio-scrcpy-'+version+'.jar';await this.phone.run(['push',jar,remote]);if(generation!==this.generation)return;
   const id=(randomBytes(4).readUInt32BE() & 0x7fffffff).toString(16).padStart(8,'0');const port=Number((await this.phone.run(['forward','tcp:0','localabstract:scrcpy_'+id])).trim());if(!port)throw new Error('Cannot open the video transport');if(generation!==this.generation){await this.phone.run(['forward','--remove','tcp:'+port]);return;}this.port=port;
   const adb=process.env.ADB || 'adb';
   this.server=spawn(adb,[...this.phone.target(),'shell','CLASSPATH='+remote,'app_process','/','com.genymobile.scrcpy.Server',version,'scid='+id,'log_level=warn','audio=false','control=false','tunnel_forward=true','raw_stream=true','max_size=960','max_fps=30','video_bit_rate=3000000','video_codec_options=repeat-previous-frame-after:long=33333,i-frame-interval:int=1','cleanup=false','power_on=false'],{stdio:['ignore','pipe','pipe']});
   let log='';for(const stream of [this.server.stdout,this.server.stderr])stream.on('data',d=>{log=(log+d).slice(-1200);});this.server.on('error',e=>this.fail(e,generation));this.server.on('exit',()=>this.fail(new Error(log || 'Phone video stopped'),generation));
   this.decoder=spawn(process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg',['-hide_banner','-loglevel','error','-probesize','32768','-analyzeduration','0','-f','h264','-i','pipe:0','-an','-threads','2','-fps_mode','passthrough','-c:v','mjpeg','-q:v','5','-f','image2pipe','pipe:1'],{stdio:['pipe','pipe','pipe']});
   this.decoder.stdin.on('error',()=>{});this.decoder.stderr.on('data',d=>{log=(log+d).slice(-1200);});this.decoder.on('error',e=>this.fail(e,generation));this.decoder.on('exit',()=>this.fail(new Error(log || 'Video decoder stopped'),generation));
   const frames=new JPEGFrames(frame=>{if(generation!==this.generation)return;this.status='live';this.frame=frame;this.frames++;for(const client of this.clients)this.write(client,frame);});this.decoder.stdout.on('data',d=>frames.push(d));
   // adb may accept a TCP connection before the Android abstract socket exists.
   for(let attempt=0;attempt<40 && generation===this.generation;attempt++){
    const socket=createConnection({host:'127.0.0.1',port:this.port});const ready=await new Promise(resolve=>{socket.once('data',first=>{socket.pause();resolve(first);});socket.once('error',()=>resolve(null));socket.once('end',()=>resolve(null));socket.setTimeout(250,()=>resolve(null));});
    if(ready){socket.setTimeout(0);this.socket=socket;this.decoder.stdin.write(ready);socket.pipe(this.decoder.stdin);socket.resume();socket.on('error',e=>this.fail(e,generation));this.starting=false;this.watchdog=setTimeout(()=>{if(this.status!=='live')this.fail(new Error('Video produced no frames'),generation);},10000);return;}
    socket.destroy();await new Promise(r=>setTimeout(r,100));
   }
   throw new Error('Phone video transport did not start');
  }catch(error){this.fail(error,generation);}finally{if(generation===this.generation)this.starting=false;}
 }
 fail(error,generation){if(generation!==this.generation)return;this.error=error.message.slice(-600);this.stop(false);this.status='error';if(this.clients.size)this.retry=setTimeout(()=>this.start(),2000);}
 stop(reset=true){++this.generation;clearTimeout(this.watchdog);clearTimeout(this.retry);this.socket?.destroy();this.socket=null;this.server?.kill('SIGTERM');this.decoder?.kill('SIGTERM');this.server=this.decoder=null;this.starting=false;const port=this.port;this.port=null;if(port)this.phone.run(['forward','--remove','tcp:'+port]).catch(()=>{});if(reset){this.status='idle';this.frame=null;}}
}
