import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MCP,rpcResult} from '../src/mcp.mjs';
test('Streamable HTTP initializes, discovers, calls read tool and closes same session',async()=>{
  const seen=[];
  const client=new MCP('https://example.test',`mcp_${'0'.repeat(64)}`,async(url,opts)=>{
    assert.equal(url,'https://example.test/api/mcp');
    if (opts.method==='DELETE') {assert.equal(opts.headers['Mcp-Session-Id'],'session-1');return new Response(null,{status:204});}
    const body=JSON.parse(opts.body);seen.push(body);
    if (body.method==='initialize') return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-03-26'}},{headers:{'Mcp-Session-Id':'session-1'}});
    assert.equal(opts.headers['Mcp-Session-Id'],'session-1');
    if (body.method==='notifications/initialized') return new Response(null,{status:202});
    return Response.json({jsonrpc:'2.0',id:body.id,result:body.method==='tools/list' ? {tools:[{name:'example_list_tables'}]} : {content:[]}});
  });
  await client.initialize();assert.equal((await client.tools())[0].name,'example_list_tables');
  await client.read('example_list_tables',{});await client.close();
  assert.deepEqual(seen.map(x=>x.method),['initialize','notifications/initialized','tools/list','tools/call']);
  await assert.rejects(client.read('example_store',{}),/read tools/);
});
test('SSE reads matching reply despite notifications and split CRLF',async()=>{
  const chunks=['data: {"jsonrpc":"2.0","method":"notification"}\r','\n\r\n','data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\r\n\r\n'];
  const stream=new ReadableStream({start(controller){for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));controller.close();}});
  assert.deepEqual(await rpcResult(new Response(stream,{headers:{'content-type':'text/event-stream'}}),7),{ok:true});
});
test('MCP errors and credentials fail explicitly',async()=>{
  assert.throws(()=>new MCP('http://example.test','invalid'));
  assert.throws(()=>new MCP('https://user:pass@example.test',`mcp_${'0'.repeat(64)}`));
  await assert.rejects(rpcResult(Response.json({jsonrpc:'2.0',id:1,error:{message:'sensitive'}}),1),/rejected/);
  await assert.rejects(rpcResult(new Response('',{status:401}),1),/401/);
});
