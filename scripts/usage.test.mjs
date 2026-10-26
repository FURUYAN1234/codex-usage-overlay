import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';

let api = {};
try { api = await import('../dist/monitor/account-usage.js'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
const implementation = () => assert.equal(typeof api.normalizeUsage, 'function', 'account usage implementation is required');
const now = Date.parse('2026-10-20T00:00:00Z');
const response = (overrides = {}) => ({rateLimits: {limitId:'codex', planType:'pro', primary:{usedPercent:28,windowDurationMins:300,resetsAt:1792458000}, secondary:{usedPercent:62,windowDurationMins:10080,resetsAt:1792972800}, credits:{balance:'1250.5',hasCredits:true,unlimited:false}, ...overrides}});

test('remaining percentages, credits and windows come from the account response', () => {
  implementation();
  const result = api.normalizeUsage(response(), now);
  assert.equal(result.buckets[0].primary.remainingPercent,72);
  assert.equal(result.buckets[0].secondary.remainingPercent,38);
  assert.equal(result.buckets[0].primary.label,'5時間枠');
  assert.equal(result.buckets[0].secondary.label,'週間枠');
  assert.deepEqual(result.credits,{kind:'balance',balance:'1250.5'});
});
test('missing or invalid quota never turns into 100 percent remaining', () => {
  implementation();
  for (const value of [undefined,null,'',NaN,-1,101,'28',Infinity]) {
    const result=api.normalizeUsage(response({primary:{usedPercent:value},secondary:null,credits:null}),now);
    assert.equal(result.buckets[0].primary,null);
    assert.equal(result.credits.kind,'unavailable');
  }
});
test('zero balance is real and missing balance is unknown', () => {
  implementation();
  assert.deepEqual(api.normalizeUsage(response({credits:{balance:'0',hasCredits:false,unlimited:false}}),now).credits,{kind:'balance',balance:'0'});
  assert.deepEqual(api.normalizeUsage(response({credits:{balance:null,hasCredits:false,unlimited:false}}),now).credits,{kind:'unavailable',balance:null});
  assert.deepEqual(api.normalizeUsage(response({credits:{unlimited:true}}),now).credits,{kind:'unlimited',balance:null});
  assert.equal(api.normalizeUsage(response({credits:{balance:'not-a-number'}}),now).credits.kind,'unavailable');
});
test('unlimited and fractional quota remain accurate', () => {
  implementation();
  const result=api.normalizeUsage(response({primary:{usedPercent:0.5,windowDurationMins:60,resetsAt:null},credits:{unlimited:true}}),now);
  assert.equal(result.buckets[0].primary.remainingPercent,99.5);
  assert.equal(result.buckets[0].primary.label,'1時間枠');
  assert.equal(result.buckets[0].primary.resetsAt,null);
});
test('multiple buckets are distinct and the legacy bucket is not duplicated', () => {
  implementation();
  const input=response();
  input.rateLimitsByLimitId={spark:{limitId:'spark',limitName:'Spark',primary:{usedPercent:8,windowDurationMins:300}},codex:input.rateLimits};
  const result=api.normalizeUsage(input,now);
  assert.deepEqual(result.buckets.map(x=>x.id),['codex','spark']);
  assert.equal(result.buckets[1].primary.remainingPercent,92);
});
test('identity and arbitrary backend text never pass to the renderer', () => {
  implementation();
  const input=response(); input.accountId='private-account'; input.email='private@example.com'; input.rawToken='secret';
  const result=JSON.stringify(api.normalizeUsage(input,now));
  assert.equal(/private|secret/.test(result),false);
});
test('only initialization and rate-limit reads may be sent to Codex', () => {
  implementation();
  assert.doesNotThrow(()=>api.makeReadRequest('initialize',1));
  assert.doesNotThrow(()=>api.makeReadRequest('account/rateLimits/read',2));
  for(const method of ['turn/start','thread/start','account/logout','account/rateLimitResetCredit/consume','account/sendAddCreditsNudgeEmail']) {
    assert.throws(()=>api.makeReadRequest(method,3),/not allowed/);
  }
});
test('unknown response fails instead of inventing a quota', () => {
  implementation();
  assert.throws(()=>api.normalizeUsage({},now),/rate limit/i);
});

function fakeTransport(mode='ready',{duplicateErrors=1,responseDelayMs=0}={}) {
  const child=new EventEmitter(); child.stdout=new PassThrough(); child.stderr=new PassThrough(); child.killed=false;
  const methods=[],requests=[];let reads=0;
  child.kill=()=>{child.killed=true;queueMicrotask(()=>child.emit('exit',0));};
  child.stdin=new Writable({write(chunk,_encoding,done){
    const message=JSON.parse(chunk.toString());methods.push(message.method);requests.push(message);done();
    if(mode==='hang'||!message.id)return;
    let reply;
    if(message.id===1)reply={id:1,result:{}};
    else if(mode==='error')reply={id:message.id,error:{message:'secret-account-token'}};
    else if(Array.isArray(mode)&&mode[reads])reply={id:message.id,error:mode[reads++]};
    else {
      const result=response();result.rateLimitsByLimitId={japanese:{limitName:'追加の利用枠',primary:{usedPercent:20}}};
      reply={id:message.id,result};
    }
    const emitReply=()=>{
      const bytes=Buffer.from(JSON.stringify(reply)+'\n');
      if(mode==='split')for(const byte of bytes)child.stdout.write(Buffer.from([byte]));
      else {child.stdout.write(bytes);if(reply.error)for(let i=1;i<duplicateErrors;i++)child.stdout.write(bytes);}
    };
    if(responseDelayMs)setTimeout(emitReply,responseDelayMs);else queueMicrotask(emitReply);
  }});
  return {child,methods,requests,spawnProcess:()=>child};
}
test('transport sends only read requests, publishes data and closes its own process',async()=>{
  implementation();const transport=fakeTransport();
  const value=await api.readAccountUsage({executable:'fixture',spawnProcess:transport.spawnProcess,timeoutMs:1000});
  assert.equal(value.buckets[0].primary.remainingPercent,72);
  assert.deepEqual(transport.methods,['initialize','initialized','account/rateLimits/read']);
  assert.equal(transport.child.killed,true);
});
test('transport timeout closes the process and never invents a result',async()=>{
  implementation();const transport=fakeTransport('hang');
  await assert.rejects(api.readAccountUsage({executable:'fixture',spawnProcess:transport.spawnProcess,timeoutMs:20}),error=>error.code==='timeout');
  assert.equal(transport.child.killed,true);
});
test('backend errors do not reveal backend text or credentials',async()=>{
  implementation();const transport=fakeTransport('error');
  await assert.rejects(api.readAccountUsage({executable:'fixture',spawnProcess:transport.spawnProcess,timeoutMs:1000}),error=>error.code==='account'&&!/secret/.test(error.message));
});
test('UTF-8 labels remain intact across arbitrary stream chunks',async()=>{
  implementation();const transport=fakeTransport('split');
  const value=await api.readAccountUsage({executable:'fixture',spawnProcess:transport.spawnProcess,timeoutMs:1000});
  assert.equal(value.buckets[1].title,'追加の利用枠');
});
test('quitting cancels the owned helper immediately',async()=>{
  implementation();const transport=fakeTransport('hang'),controller=new AbortController();
  const pending=api.readAccountUsage({executable:'fixture',spawnProcess:transport.spawnProcess,timeoutMs:1000,signal:controller.signal});
  controller.abort();
  await assert.rejects(pending,error=>error.code==='cancelled');
  assert.equal(transport.child.killed,true);
});
test('out-of-range reset timestamps remain unavailable',()=>{
  implementation();
  assert.equal(api.normalizeUsage(response({primary:{usedPercent:20,resetsAt:1e20}}),now).buckets[0].primary.resetsAt,null);
});
test('a termination request is not mistaken for confirmed process exit',async()=>{
  const transport=fakeTransport();let closed=false;
  transport.child.kill=()=>{setTimeout(()=>{closed=true;transport.child.emit('exit',0);},20);return true;};
  await api.readAccountUsage({executable:'fixture',spawnProcess:transport.spawnProcess,timeoutMs:1000});
  assert.equal(closed,true);
});
test('failed termination is reported rather than claiming cleanup',async()=>{
  const transport=fakeTransport();transport.child.kill=()=>false;
  await assert.rejects(api.readAccountUsage({executable:'fixture',spawnProcess:transport.spawnProcess,timeoutMs:1000,closeTimeoutMs:25}),error=>error.code==='cleanup');
});

const droppedResponse={code:-32603,message:'failed to fetch codex rate limits: error sending request for url (https://chatgpt.com/backend-api/wham/usage)'};
const readRequests=transport=>transport.requests.filter(request=>request.method==='account/rateLimits/read');

test('a dropped usage response recovers on the same helper with a fresh request ID',async()=>{
  const transport=fakeTransport([droppedResponse]);let spawns=0;
  const value=await api.readAccountUsage({executable:'fixture',spawnProcess:()=>{spawns++;return transport.child;},timeoutMs:1000,retryDelayMs:1});
  assert.equal(value.buckets[0].primary.remainingPercent,72);
  assert.equal(spawns,1);
  assert.deepEqual(transport.methods,['initialize','initialized','account/rateLimits/read','account/rateLimits/read']);
  assert.equal(new Set(readRequests(transport).map(request=>request.id)).size,2);
  assert.equal(transport.child.killed,true);
});

test('repeated transport failure stops after three reads without exposing backend text',async()=>{
  const transport=fakeTransport(Array(10).fill(droppedResponse));
  await assert.rejects(api.readAccountUsage({executable:'fixture',spawnProcess:transport.spawnProcess,timeoutMs:1000,retryDelayMs:1}),error=>error.code==='network'&&!error.message.includes('https://'));
  assert.equal(readRequests(transport).length,3);
  assert.equal(transport.child.killed,true);
});

test('duplicate failure responses cannot queue extra read attempts',async()=>{
  const transport=fakeTransport(Array(10).fill(droppedResponse),{duplicateErrors:3,responseDelayMs:10});
  await assert.rejects(api.readAccountUsage({executable:'fixture',spawnProcess:transport.spawnProcess,timeoutMs:1000,retryDelayMs:5}),error=>error.code==='network');
  assert.equal(readRequests(transport).length,3);
});

test('authentication and other permanent errors are never retried',async()=>{
  for(const error of [{code:-32603,message:'failed to fetch codex rate limits: unexpected status 401 Unauthorized'}, {code:-32603,message:'failed to fetch codex rate limits: error sending request: 401 Unauthorized'}, {code:-32603,message:'failed to fetch codex rate limits: error sending request: invalid certificate'}, {code:-32603,message:'secret-account-token'}]){
    const transport=fakeTransport([error]);
    await assert.rejects(api.readAccountUsage({executable:'fixture',spawnProcess:transport.spawnProcess,timeoutMs:1000,retryDelayMs:1}),value=>value.code==='account');
    assert.equal(readRequests(transport).length,1);
  }
});

test('cancelling during retry prevents another request and closes the helper',async()=>{
  const transport=fakeTransport([droppedResponse]),controller=new AbortController();
  const pending=api.readAccountUsage({executable:'fixture',spawnProcess:transport.spawnProcess,timeoutMs:1000,retryDelayMs:50,signal:controller.signal});
  setTimeout(()=>controller.abort(),10);
  await assert.rejects(pending,error=>error.code==='cancelled');
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(readRequests(transport).length,1);
  assert.equal(transport.child.killed,true);
});

test('the original overall deadline also bounds retry delays',async()=>{
  const transport=fakeTransport([droppedResponse]);
  await assert.rejects(api.readAccountUsage({executable:'fixture',spawnProcess:transport.spawnProcess,timeoutMs:20,retryDelayMs:50}),error=>error.code==='timeout');
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(readRequests(transport).length,1);
  assert.equal(transport.child.killed,true);
});

test('public error messages distinguish transport failures and never forward arbitrary errors',()=>{
  assert.equal(typeof api.usageErrorMessage,'function');
  assert.equal(api.usageErrorMessage(new api.UsageReadError('network')),'Codexとの通信が途切れました');
  assert.equal(api.usageErrorMessage(new api.UsageReadError('timeout')),'取得がタイムアウトしました');
  assert.equal(api.usageErrorMessage({code:'network',message:'secret-account-token'}),'残量データを確認できませんでした');
  assert.equal(api.usageErrorMessage(new Error('secret-account-token')),'残量データを確認できませんでした');
});
