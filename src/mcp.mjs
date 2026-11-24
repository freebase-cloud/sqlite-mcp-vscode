// Minimal Streamable HTTP client: initialize, discovery, bounded read calls, close.
// Intentionally not a general MCP SDK (no OAuth, SSE reconnect, or write retries).
export async function rpcResult(response, id) {
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
  const accept = value => {
    if (!value || value.jsonrpc !== '2.0' || value.id !== id) throw new Error('Unexpected MCP reply');
    if (value.error) throw new Error('MCP rejected the request');
    return value.result;
  };
  if ((response.headers.get('content-type') || '').includes('application/json')) return accept(await response.json());
  if (!(response.headers.get('content-type') || '').includes('text/event-stream')) throw new Error('Unsupported MCP response type');
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let buffer='', size=0;
  try {
    while (true) {
      const {done,value}=await reader.read();
      if (done) throw new Error('MCP stream ended before its reply');
      size+=value.length;
      if (size>2_000_000) throw new Error('MCP stream exceeded the example size limit');
      buffer+=decoder.decode(value,{stream:true}).replaceAll('\r\n','\n');
      // Normalize CRLF after concatenation too, including split CR/LF chunks.
      buffer=buffer.replaceAll('\r\n','\n');
      let end;
      while ((end=buffer.indexOf('\n\n'))>=0) {
        const event=buffer.slice(0,end); buffer=buffer.slice(end+2);
        const data=event.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const message=JSON.parse(data);
        if (message.id===id) return accept(message);
      }
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
}
export class MCP {
  constructor(origin, token, transport=fetch) {
    const url=new URL(origin);
    if (url.origin !== origin || url.protocol!=='https:') throw new Error('MCP requires an HTTPS origin without path or credentials');
    if (!/^mcp_[a-f0-9]{64}$/.test(token || '')) throw new Error('Set FREEBASE_MCP_TOKEN from website Settings → MCP');
    this.origin=origin; this.token=token; this.transport=transport; this.nextId=1;
  }
  async send(method, params={}, notification=false) {
    const id=this.nextId++;
    let response;
    try {
      response=await this.transport(`${this.origin}/api/mcp`, {
        method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
        headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream',
          ...(this.session ? {'Mcp-Session-Id':this.session} : {}),...(this.protocol ? {'MCP-Protocol-Version':this.protocol} : {})},
        body:JSON.stringify({jsonrpc:'2.0',...(notification ? {} : {id}),method,params}),
      });
    } catch { throw new Error('MCP transport failed; no call was retried'); }
    if (notification) { if (!response.ok) throw new Error(`MCP notification HTTP ${response.status}`); await response.body?.cancel(); return; }
    const result=await rpcResult(response,id);
    const session=response.headers.get('mcp-session-id');
    if (session) this.session=session;
    return result;
  }
  async initialize() {
    const result=await this.send('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'freebase-examples',version:'1.0.0'}});
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result?.protocolVersion || '')) throw new Error('Invalid MCP initialization');
    this.protocol=result.protocolVersion;
    await this.send('notifications/initialized',{},true);
    return result;
  }
  async tools() {
    let cursor; const tools=[];
    for (let page=0;page<20;page++) {
      const result=await this.send('tools/list',cursor ? {cursor} : {});
      if (!Array.isArray(result?.tools)) throw new Error('Invalid MCP tool discovery result');
      tools.push(...result.tools);
      if (!result.nextCursor) return tools;
      cursor=result.nextCursor;
    }
    throw new Error('Too many MCP tool pages');
  }
  async read(tool, args) {
    if (!/^[a-zA-Z0-9_]+_(list_tables|get|query)$/.test(tool)) throw new Error('This example permits only named read tools');
    const result=await this.send('tools/call',{name:tool,arguments:args});
    if (result?.isError) throw new Error('MCP tool reported an error');
    for (const item of result?.content || []) {
      if (item.type!=='text') continue;
      let data;
      try { data=JSON.parse(item.text); } catch { continue; }
      if (data?.error) throw new Error('MCP data query failed');
    }
    return result;
  }
  async close() {
    if (!this.session) return;
    try {
      const response=await this.transport(`${this.origin}/api/mcp`,{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(10000),
        headers:{Authorization:`Bearer ${this.token}`,'Mcp-Session-Id':this.session,'MCP-Protocol-Version':this.protocol}});
      if (!response.ok && response.status!==404) throw new Error();
      await response.body?.cancel();
    } catch { throw new Error('Could not confirm MCP session closure'); }
  }
}
