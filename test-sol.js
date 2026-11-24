process.env.SOL_TREASURY='TrEaSuRyAddr1111111111111111111111111111111';
const assert=require('assert');
const real=global.fetch; let reply;
global.fetch=async(u,o)=>({ok:true,json:async()=>({result:reply})});
const sol=require('./sol.js');
const USDC='4zMMC9srt5Ri5X14GAgXhaHii3GfPPjkWQEwFYk7M2zz', T='TrEaSuRyAddr1111111111111111111111111111111', ME='UserWallet';
const base=(extra)=>({transaction:{message:{accountKeys:[{pubkey:ME,signer:true}],instructions:[]}},meta:{err:null,preTokenBalances:[],postTokenBalances:[]},...extra});
(async()=>{
 reply=null; assert.deepEqual(await sol.verifyPayment('s',ME),{pending:true});
 // USDC 3.34 from user to treasury
 reply=base({meta:{err:null,preTokenBalances:[{owner:ME,mint:USDC,uiTokenAmount:{amount:'10000000'}}],postTokenBalances:[{owner:ME,mint:USDC,uiTokenAmount:{amount:'6660000'}},{owner:T,mint:USDC,uiTokenAmount:{amount:'3340000'}}]}});
 let v=await sol.verifyPayment('s',ME); assert.equal(v.token,'USDC'); assert.equal(v.usdc,3.34); assert.equal(v.naira,5010);
 // someone else's wallet signed
 await assert.rejects(()=>sol.verifyPayment('s','OtherWallet'),/not signed by your connected wallet/);
 // treasury gained but sender did not lose (forged)
 reply=base({meta:{err:null,preTokenBalances:[],postTokenBalances:[{owner:T,mint:USDC,uiTokenAmount:{amount:'3340000'}}]}});
 await assert.rejects(()=>sol.verifyPayment('s',ME),/did not go from your wallet/);
 // wrong mint
 reply=base({meta:{err:null,preTokenBalances:[{owner:ME,mint:'FAKE',uiTokenAmount:{amount:'9000000'}}],postTokenBalances:[{owner:ME,mint:'FAKE',uiTokenAmount:{amount:'5000000'}},{owner:T,mint:'FAKE',uiTokenAmount:{amount:'4000000'}}]}});
 await assert.rejects(()=>sol.verifyPayment('s',ME),/did not go from your wallet/);
 // SOL transfer still works
 reply=base({transaction:{message:{accountKeys:[{pubkey:ME,signer:true}],instructions:[{program:'system',parsed:{type:'transfer',info:{source:ME,destination:T,lamports:'100000000'}}}]}}});
 v=await sol.verifyPayment('s',ME); assert.equal(v.token,'SOL'); assert.equal(v.naira,Math.floor(0.1*150*1500));
 // failed tx
 reply=base({meta:{err:{x:1}}}); await assert.rejects(()=>sol.verifyPayment('s',ME),/failed on Solana/);
 console.log('SOLANA VERIFY OK');
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
