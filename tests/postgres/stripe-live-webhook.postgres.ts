import {test,expect} from 'vitest';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import Stripe from 'stripe';
import {db} from '@/lib/server/db';
import {receiveStripeTestWebhook} from '@/lib/server/stripe-webhook-inbox';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('real sandbox CLI signatures reach the actual durable HTTP inbox',async()=>{
 const stripe=new Stripe(process.env.STRIPE_SECRET_KEY!);expect((await stripe.balance.retrieve()).livemode).toBe(false);
 const secret=readFileSync('/private/tmp/bundleen-stripe-webhook-secret','utf8').trim();
 process.env.STRIPE_WEBHOOK_SECRET=secret;process.env.STRIPE_CONNECT_WEBHOOK_SECRET=secret;process.env.STRIPE_TEST_WEBHOOK_INTAKE='1';
 const ready='/private/tmp/bundleen-stripe-listener-ready',stop='/private/tmp/bundleen-stripe-listener-stop';
 for(const p of [ready,stop])if(existsSync(p))unlinkSync(p);
 const server=createServer(async(req,res)=>{try{const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const response=await receiveStripeTestWebhook(new Request('http://127.0.0.1:4361'+req.url,{method:'POST',headers:{'stripe-signature':String(req.headers['stripe-signature']??'')},body:Buffer.concat(chunks)}),req.url==='/connect'?'connect':'platform');res.writeHead(response.status);res.end(await response.text());}catch{res.writeHead(500);res.end('handler failure');}});
 let cli:ReturnType<typeof spawn>|undefined;let customerId:string|undefined;
 try{
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(4361,'127.0.0.1',resolve);});
 cli=spawn('/private/tmp/bundleen-stripe-cli/node_modules/.bin/stripe',['listen','--skip-update','--forward-to','http://127.0.0.1:4361/platform','--forward-connect-to','http://127.0.0.1:4361/connect','--events','customer.created,account.updated,payment_intent.succeeded,payment_intent.payment_failed,charge.refunded,transfer.created,transfer.reversed'],{env:{...process.env,STRIPE_API_KEY:process.env.STRIPE_SECRET_KEY,STRIPE_NO_AUTO_UPDATE:'1'},stdio:['ignore','pipe','pipe']});
 let listening=false;cli.on('error',()=>{listening=false;});const receive=(b:Buffer)=>{if(b.toString().includes('Ready!'))listening=true;};cli.stdout?.on('data',receive);cli.stderr?.on('data',receive);
  for(let i=0;i<100&&!listening;i++)await sleep(100);expect(listening).toBe(true);writeFileSync(ready,'ready',{mode:0o600});
  const customer=await stripe.customers.create({description:'Bundleen isolated webhook verification',metadata:{bundleen_test_run:randomUUID()}});customerId=customer.id;
  let event=null;for(let i=0;i<150&&!event;i++){event=await db.stripeTestEvent.findFirst({where:{objectId:customer.id,eventType:'customer.created'}});if(!event)await sleep(200);}
  expect(Boolean(event)).toBe(true);
  const invalid=await fetch('http://127.0.0.1:4361/platform',{method:'POST',body:'{}',headers:{'stripe-signature':'invalid'}});expect(invalid.status).toBe(400);
  writeFileSync('/private/tmp/bundleen-stripe-webhook-evidence.json',JSON.stringify({realSignedDelivery:true,invalidSignatureRejected:true,eventId:event!.id,customerId},null,2),{mode:0o600});
  // Keep the same real listener available for the separately owned domain sandbox suite.
  for(let i=0;i<540&&!existsSync(stop);i++)await sleep(1000);
 }finally{cli?.kill('SIGTERM');await new Promise<void>(r=>server.close(()=>r()));if(existsSync(ready))unlinkSync(ready);if(customerId)await stripe.customers.del(customerId);await db.$disconnect();}
});
