(function(){"use strict";

var _configuredPort=Number(new URLSearchParams(location.search).get('bridgePort'));
var PORT=_configuredPort||8000,MAX_LOGS=300,_logs=[],_panelOpen=false,_panelEl=null,_logAreaEl=null,_statusEl=null;
var _paused=false,_backoffUntil=0,_pauseBtn=null,_needSlowRebuild=false;
var _lastSlowState={};
var _control=null,_pollBusy=false,_pendingReceipts=[];
var _rendererToken=null;
var _controlBase=document.currentScript&&document.currentScript.src?new URL('.',document.currentScript.src).href:'http://localhost:'+PORT+'/bridge/';
try{_pendingReceipts=JSON.parse(sessionStorage.getItem('CookieBridgeReceiptsV3')||'[]');if(!Array.isArray(_pendingReceipts))_pendingReceipts=[];}catch(e){_pendingReceipts=[];}
function persistReceipts(){try{sessionStorage.setItem('CookieBridgeReceiptsV3',JSON.stringify(_pendingReceipts));}catch(e){log('warn','Cannot persist receipts across a renderer reload: '+e.message);}}

// Mapeamento: nome da API → chave real no Game.prefs (e se é invertida)
var PREF_MAP={
  fancy:{key:"fancy",inv:false},filters:{key:"filters",inv:false},milk:{key:"milk",inv:false},
  cursors:{key:"cursors",inv:false},particles:{key:"particles",inv:false},numbers:{key:"numbers",inv:false},
  wobbly:{key:"wobbly",inv:false},animate:{key:"animate",inv:false},crates:{key:"crates",inv:false},
  monospace:{key:"monospace",inv:false},cookiesound:{key:"cookiesound",inv:false},
  format:{key:"format",inv:false},warn:{key:"warn",inv:false},focus:{key:"focus",inv:false},
  extraButtons:{key:"extraButtons",inv:false},lumpConfirm:{key:"askLumps",inv:false},
  screenReader:{key:"screenreader",inv:false},fastNotes:{key:"notifs",inv:false},
  scary:{key:"notScary",inv:true},customGrandmas:{key:"customGrandmas",inv:false},
  autosave:{key:"autosave",inv:false},timeout:{key:"timeout",inv:false},
  cloudSave:{key:"cloudSave",inv:false},bgMusic:{key:"bgMusic",inv:false},
  fullscreen:{key:"fullscreen",inv:false},discordPresence:{key:"discordPresence",inv:false}
};

function log(lv,msg){
  var e={t:new Date().toLocaleTimeString("pt-BR"),level:lv,msg:String(msg)};
  _logs.push(e);if(_logs.length>MAX_LOGS)_logs.shift();
  if(lv==="error")console.error("[API] "+msg);
  else if(lv==="warn")console.warn("[API] "+msg);
  else console.log("[API] "+msg);
  if(_panelOpen&&_logAreaEl)_appendLog(e);
}
function _esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function _appendLog(e){
  var c={info:"#90ee90",warn:"#f5e642",error:"#ff6b6b"};
  var d=document.createElement("div");
  d.style.cssText="padding:2px 0;border-bottom:1px solid #111;word-break:break-all";
  d.innerHTML="<span style='color:#555'>["+e.t+"]</span> <span style='color:"+(c[e.level]||"#ccc")+"'>"+_esc(e.msg)+"</span>";
  _logAreaEl.appendChild(d);_logAreaEl.scrollTop=_logAreaEl.scrollHeight;
}
function _renderLogs(){if(!_logAreaEl)return;_logAreaEl.innerHTML="";_logs.forEach(_appendLog);_logAreaEl.scrollTop=_logAreaEl.scrollHeight;}
function setStatus(ok,msg){if(!_statusEl)return;_statusEl.textContent=msg;_statusEl.style.background=ok?"#1a3a1a":"#3a1a1a";_statusEl.style.color=ok?"#2d9e54":"#ff6b6b";}

function createPanel(){
  var btn=document.createElement("div");
  btn.id="cookiebridge-toggle";btn.textContent="API";
  btn.style.cssText="position:fixed;bottom:60px;right:10px;z-index:999999;background:#1a1a2e;color:#f5e642;border:2px solid #f5e642;border-radius:6px;padding:5px 13px;cursor:pointer;font-size:13px;font-weight:bold;font-family:Arial,sans-serif;user-select:none";
  btn.addEventListener("click",function(){
    _panelOpen=!_panelOpen;
    _panelEl.style.display=_panelOpen?"flex":"none";
    btn.style.background=_panelOpen?"#f5e642":"#1a1a2e";
    btn.style.color=_panelOpen?"#1a1a2e":"#f5e642";
    if(_panelOpen)_renderLogs();
  });
  document.body.appendChild(btn);

  var panel=document.createElement("div");
  panel.id="cookiebridge-panel";
  panel.style.cssText="position:fixed;bottom:100px;right:10px;z-index:999998;width:430px;max-height:360px;background:#0d0d1a;border:2px solid #f5e642;border-radius:8px;font-family:monospace;font-size:12px;display:none;flex-direction:column;box-shadow:0 4px 24px rgba(0,0,0,0.8)";

  var hdr=document.createElement("div");
  hdr.style.cssText="background:#1a1a2e;padding:8px 12px;color:#f5e642;font-weight:bold;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center;flex-shrink:0";
  var ttl=document.createElement("span");ttl.textContent="Cookie Bridge v3";
  var sbadge=document.createElement("span");
  sbadge.style.cssText="font-size:11px;padding:2px 9px;border-radius:3px;background:#222;color:#888";
  sbadge.textContent="iniciando...";_statusEl=sbadge;
  hdr.appendChild(ttl);hdr.appendChild(sbadge);

  var tbar=document.createElement("div");
  tbar.style.cssText="background:#111;padding:5px 8px;border-bottom:1px solid #222;display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;align-items:center";

  function mkBtn(label,fn){
    var b=document.createElement("button");b.textContent=label;
    b.style.cssText="background:#1a1a2e;color:#ccc;border:1px solid #444;border-radius:3px;padding:3px 9px;cursor:pointer;font-size:11px;font-family:monospace";
    b.addEventListener("click",fn);return b;
  }

  tbar.appendChild(mkBtn("Limpar",function(){_logs=[];if(_logAreaEl)_logAreaEl.innerHTML="";}));

  // Pausar / Retomar loop de fetch
  _pauseBtn=mkBtn("Pausar",function(){
    _paused=!_paused;
    _pauseBtn.textContent=_paused?"Retomar":"Pausar";
    _pauseBtn.style.color=_paused?"#ff6b6b":"#ccc";
    if(!_paused)_backoffUntil=0;
    setStatus(!_paused,_paused?"pausado":"ativo");
    log("info",_paused?"API pausada.":"API retomada.");
  });
  tbar.appendChild(_pauseBtn);

  tbar.appendChild(mkBtn("Ping",function(){
    request("/")
    .then(function(d){log("info","Ping OK · jogo="+d.jogo_conectado+" · bakery="+d.confeitaria);})
    .catch(function(e){log("error","Ping: "+e.message);});
  }));

  tbar.appendChild(mkBtn("State",function(){
    request("/state")
    .then(function(d){log("info","cookies="+d.cookies_na_conta+" · cps="+d.cookies_por_segundo);})
    .catch(function(e){log("error","State: "+e.message);});
  }));

  tbar.appendChild(mkBtn("Fila",function(){
    request("/action/queue")
    .then(function(d){log("info","Fila: "+d.total+" ação(ões) pendente(s)");})
    .catch(function(e){log("error","Fila: "+e.message);});
  }));

  tbar.appendChild(mkBtn("Wrink",function(){
    var ws=(Game.wrinklers||[]).filter(function(w){return w.phase>0;});
    log("info","Wrinklers: "+ws.length+" ativos · sucked="+ws.reduce(function(a,w){return a+w.sucked;},0).toFixed(0));
  }));

  // Copia o state atual para a área de transferência (útil para depuração offline)
  tbar.appendChild(mkBtn("Copiar",function(){
    var state=buildState();
    navigator.clipboard.writeText(JSON.stringify(state,null,2)).then(function(){
      log("info","State copiado para a área de transferência!");
    }).catch(function(err){
      log("error","Erro ao copiar: "+err);
    });
  }));

  // The trusted main process owns the authenticated endpoint.
  var portLabel=document.createElement("span");
  portLabel.textContent="Porta:";
  portLabel.style.cssText="color:#888;font-size:10px;white-space:nowrap";
  var portInput=document.createElement("input");
  portInput.id="cookiebridge-port-input";
  portInput.type="text";portInput.value=PORT;
  portInput.readOnly=true;
  portInput.style.cssText="width:50px;background:#1a1a2e;color:#ccc;border:1px solid #333;border-radius:3px;padding:2px 5px;font-size:11px;font-family:monospace";
  tbar.appendChild(portLabel);
  tbar.appendChild(portInput);

  var la=document.createElement("div");
  la.style.cssText="overflow-y:auto;flex:1;padding:8px 10px;color:#ccc;min-height:80px";
  _logAreaEl=la;

  // Links open in the user's browser, where the dashboard has its own login.
  var ft=document.createElement("div");
  ft.style.cssText="background:#111;padding:4px 10px;border-top:1px solid #222;color:#555;font-size:11px;flex-shrink:0";
  ft.innerHTML="<a href='http://localhost:"+PORT+"/docs' target='_blank' style='color:#5bc8f5'>Swagger UI</a> &nbsp;|&nbsp; porta "+PORT;

  panel.appendChild(hdr);panel.appendChild(tbar);panel.appendChild(la);panel.appendChild(ft);
  document.body.appendChild(panel);_panelEl=panel;
}

// ─── Estado rápido: campos que mudam a cada ~500ms ─────────────────────────
function buildFastState(){
  var buffsAtivos={};
  Object.keys(Game.buffs||{}).forEach(function(k){
    var b=Game.buffs[k];
    if(b&&b.time)buffsAtivos[k]={timeLeft:b.time,multCpS:b.multCpS||1,multClick:b.multClick||1};
  });
  var shimmers=(Game.shimmers||[]).map(function(s,i){
    return{index:i,type:s.type||"golden",timeLeft:s.life||0,
      pos_x:s.pos?s.pos[0]:null,pos_y:s.pos?s.pos[1]:null};
  });
  var sl={disponiveis:Game.lumps||0,tipo_crescendo:Game.lumpCurrentType||null,tempo_para_maduro_ms:null};
  if(Game.lumpRipeAge&&Game.lumpT)sl.tempo_para_maduro_ms=Math.max(0,Game.lumpRipeAge-(Date.now()-Game.lumpT));
  var wrinklers=(Game.wrinklers||[]).map(function(w,i){
    return{id:i,phase:w.phase||0,sucked:w.sucked||0,type:w.type||0,hp:w.hp||0,close:w.close||0};
  });
  return{
    timestamp:Date.now(),
    bakery_name:Game.bakeryName||"Unknown",
    cookies_na_conta:Game.cookies||0,
    cookies_por_segundo:Game.cookiesPs||0,
    cookies_por_segundo_raw:Game.cookiesPsRaw||Game.cookiesPs||0,
    cookies_por_click:Game.computedMouseCps||0,
    estatisticas:{
      total_cookies_ganhos:Game.cookiesEarned||0,total_cookies_reset:Game.cookiesReset||0,
      total_cliques:Game.cookieClicks||0,cookies_manuais:Game.handmadeCookies||0,
      cookies_com_wrinklers:Game.cookiesSucked||0,
      ascensoes:Game.resets||0,prestige:Game.prestige||0,
      heavenly_chips:Game.heavenlyChips||0,heavenly_chips_gastos:Game.heavenlyChipsSpent||0,
      fps:Game.fps||30,estacao:Game.season||"none",versao_jogo:Game.version||"?",nivel_dragao:Game.dragonLevel||0
    },
    buffs_ativos:buffsAtivos,
    shimmers:shimmers,
    sugar_lumps:sl,
    wrinklers:wrinklers,
    estacao_ativa:{nome:Game.season||"",tempo_restante_frames:Game.seasonT||0,usos:Game.seasonUses||0},
    volume:{sfx:Game.volume!==undefined?Game.volume:75,music:Game.volumeMusic!==undefined?Game.volumeMusic:50}
  };
}

// The same versioned action contract is used by HTTP and MCP.
function buildSlowState(){return _control.snapshot();}
function buildState(){
  var state=Object.assign({},_lastSlowState,buildFastState());
  if(_control&&state.control)state.control=Object.assign({},state.control,{live:_control.liveState()});
  return state;
}
async function executeAction(action){
  var receipt=await _control.execute(action);
  if(action._bridge)receipt.id=action._bridge.id;
  _needSlowRebuild=true;
  log(receipt.status==="failed"?"error":"info",receipt.status+" "+action.type+(receipt.error?" · "+receipt.error.message:""));
  return receipt;
}
function loadControl(){
  function script(name){
    return new Promise(function(resolve,reject){
      var el=document.createElement("script");
      el.src=_controlBase+name;el.onload=resolve;el.onerror=function(){reject(new Error("Cannot load "+el.src));};
      document.head.appendChild(el);
    });
  }
  return Promise.resolve()
    .then(function(){if(!window.CookieBridgeSchema)return script("control-schema.js");})
    .then(function(){if(!window.CookieBridgeControl)return script("control-runtime.js");})
    .then(function(){
      if(window.CookieBridgeSchema.version!==window.CookieBridgeControl.version)throw new Error("Control modules have different versions. Reinstall Cookie Bridge.");
      _control=window.CookieBridgeControl.create(Game,window);
      _needSlowRebuild=true;
      log("info","Full control API "+window.CookieBridgeSchema.version+" ready.");
    });
}
function request(path,body){
  if(!_rendererToken)return Promise.reject(new Error('Renderer authentication is not ready.'));
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},15000);
  return fetch("http://127.0.0.1:"+PORT+path,body===undefined?{signal:controller.signal,headers:{Authorization:'Bearer '+_rendererToken},redirect:'error'}:{
    signal:controller.signal,
    method:"POST",headers:{"Content-Type":"application/json",Authorization:'Bearer '+_rendererToken},redirect:'error',body:JSON.stringify(body)
  }).then(function(r){if(!r.ok&&r.status!==204)throw new Error(path+" HTTP "+r.status);return r.status===204?null:r.json();}).finally(function(){clearTimeout(timer);});
}

Game.registerMod("cookie_ai_bridge",{
  init:function(){
    createPanel();
    log("info","Mod v3 iniciado — Cookie Clicker "+(Game.version||"?"));
    setStatus(false,"loading control API");
    Promise.resolve().then(function(){
      if(!window.cookieBridgeConnection)throw new Error('Secure preload is missing. Reinstall Cookie Bridge.');
      return window.cookieBridgeConnection.connect();
    }).then(function(connection){
      if(connection.port!==PORT)throw new Error('Unexpected bridge port.');
      _rendererToken=connection.token;return loadControl();
    }).then(function(){setStatus(true,"ativo");}).catch(function(e){log("error",e.message);setStatus(false,"control API unavailable");});
    Game.Notify("Cookie Bridge v3","API em http://localhost:"+PORT+" | Swagger: /docs",[0,0],8000);

    var fc=0,sc=0;
    Game.registerHook("logic",function(){
      fc++;
      if(fc%15!==0)return;
      if(!_control||_pollBusy||_paused||Date.now()<_backoffUntil)return;

      // Estado lento: primeira vez, a cada 10 polls (~5s) ou após ação
      sc++;
      _pollBusy=true;
      Promise.resolve().then(function(){
        if(sc===1||sc%10===0||_needSlowRebuild){
          _lastSlowState=buildSlowState();_needSlowRebuild=false;
        }
        return request('/state',buildState());
      }).then(function(){
        setStatus(true,'ativo');
        // Acknowledgements follow the refreshed state. Retry receipts, never actions.
        if(!_pendingReceipts.length)return;
        var batch=_pendingReceipts.slice();
        return request('/action/results',{results:batch}).then(function(){_pendingReceipts.splice(0,batch.length);persistReceipts();});
      }).then(function(){return request('/action/next');})
        .then(async function(a){if(a){var receipt=await executeAction(a);if(receipt.id){_pendingReceipts.push(receipt);persistReceipts();}}})
        .catch(function(e){_backoffUntil=Date.now()+5000;setStatus(false,'offline/error (5s)');log('error',e.message);})
        .finally(function(){_pollBusy=false;});
    });

    // Exposição global para depuração no console do DevTools (F12)
    window.CookieBridge={
      testarAcao:function(a){if(!_control)throw new Error('Control API is loading');return executeAction(a);},
      verEstado:buildState,
      pausar:function(){
        _paused=true;
        if(_pauseBtn){_pauseBtn.textContent="Retomar";_pauseBtn.style.color="#ff6b6b";}
        setStatus(false,"pausado");log("info","API pausada via console.");
      },
      retomar:function(){
        _paused=false;_backoffUntil=0;
        if(_pauseBtn){_pauseBtn.textContent="Pausar";_pauseBtn.style.color="#ccc";}
        setStatus(true,"ativo");log("info","API retomada via console.");
      }
    };
  },

  // Persiste a porta configurada pelo usuário no save do jogo
  save:function(){return JSON.stringify({porta:PORT});},
  load:function(str){
    if(str){
      try{
        var d=JSON.parse(str);
        if(d&&typeof d.porta==='number'&&d.porta>0&&d.porta<65536){
          PORT=_configuredPort||d.porta;
          // Sync the panel input if it was already created (init ran before load)
          var inp=document.getElementById("cookiebridge-port-input");
          if(inp)inp.value=PORT;
        }
      }catch(e){}
    }
  },
});

})();
