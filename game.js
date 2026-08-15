(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 800, H = 600;

  function resize(){
    W = canvas.width = innerWidth;
    H = canvas.height = innerHeight;
  }
  addEventListener('resize', resize);
  resize();

  const scoreEl = document.getElementById('score');
  const overlays = {
    title: document.querySelector('.overlay.title-screen'),
    pause: document.querySelector('.overlay.pause-screen'),
    win: document.querySelector('.overlay.win-screen'),
    lose: document.querySelector('.overlay.lose-screen')
  };

  const playBtn = document.getElementById('playBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const againWin = document.getElementById('againWin');
  const againLose = document.getElementById('againLose');

  let state = 'title';
  let redWins = 0, blueWins = 0;
  const MAX_WINS = 11;
  let gameOver = false;
  // prevent bot from acting immediately at round start
  let roundStartTimer = 0;

  const keys = {};
  addEventListener('keydown', e=>{
    if (e.code === 'Space') e.preventDefault();
    keys[e.code] = true;
    if (e.key === 'p' || e.key === 'P') { togglePause(); }
  });
  addEventListener('keyup', e=>{ keys[e.code]=false });

  playBtn.addEventListener('click', startGame);
  resumeBtn.addEventListener('click', ()=>{ if(!gameOver){ state='playing'; updateOverlays(); } });
  againWin.addEventListener('click', startGame);
  againLose.addEventListener('click', startGame);

  function showOverlay(name){ state = name; updateOverlays(); }
  function updateOverlays(){
    for(const k in overlays){ if(!overlays[k]) continue; overlays[k].classList.toggle('active', k===state); }
  }

  function togglePause(){ if(state==='playing'){ state='pause'; updateOverlays(); } else if(state==='pause'){ state='playing'; updateOverlays(); }}

  // Platform in middle
  const platform = { w: Math.min(700, W*0.5), h: 18, x:0, y:0 };
  function updatePlatform(){ platform.w = Math.min(700, W*0.5); platform.x = (W-platform.w)/2; platform.y = H/2; }
  updatePlatform();

  // Balls
  function makeBall(x, y, r, color, isPlayer){
    return { x,y,vx:0,vy:0,r,color,isPlayer,canJump:false };
  }

  let player, bot;

  function resetBalls(){
    updatePlatform();
    const left = platform.x + platform.w*0.2;
    const right = platform.x + platform.w*0.8;
    player = makeBall(left, platform.y - 30, 22, 'red', true);
    bot = makeBall(right, platform.y - 30, 22, 'blue', false);
  }

  function startGame(){
    if(gameOver) return;
    resetBalls();
    state='playing';
    updateOverlays();
    if(playBtn) playBtn.style.display = 'none';
    roundStartTimer = 60; // give player ~1 second (60 frames) grace before bot jumps
  }

  // Physics
  const gravity = 0.9;
  const friction = 0.995;
  const bounce = 0.8;
  // Difficulty amplifier: >1 => harder AI, <1 => easier. Hard by default.
  let difficultyAmplifier = 3;
  // Ball speed multiplier: <1 slows movement, >1 speeds up. Slower by default.
  let ballSpeedMultiplier = 0.3;
  // expose setters for quick tuning from console
  window.setDifficulty = (v) => { difficultyAmplifier = Math.max(0.1, Number(v) || difficultyAmplifier); };
  window.setBallSpeed = (v) => { ballSpeedMultiplier = Math.max(0.05, Number(v) || ballSpeedMultiplier); };

  function stepPhysics(){
    [player,bot].forEach(b=>{
      b.vy += gravity;
      b.vx *= friction;
      // apply global speed multiplier when integrating position
      b.x += b.vx * ballSpeedMultiplier;
      b.y += b.vy * ballSpeedMultiplier;
    });

    // Platform collision (only if over platform area)
    [player,bot].forEach(b=>{
      const onPlat = (b.x > platform.x - b.r && b.x < platform.x + platform.w + b.r);
      if(onPlat && b.y + b.r > platform.y && b.y + b.r < platform.y + 60 && b.vy > 0){
        b.y = platform.y - b.r;
        b.vy = -b.vy * bounce;
        if(Math.abs(b.vy) < 1) b.vy = 0;
        b.canJump = true;
      }
    });

    // Wall wrap/limit horizontally (keep within world)
    [player,bot].forEach(b=>{
      if(b.x - b.r < 0) { b.x = b.r; b.vx = -b.vx * 0.6 }
      if(b.x + b.r > W) { b.x = W - b.r; b.vx = -b.vx * 0.6 }
    });

    // Ball-ball collision
    collideBalls(player, bot);
  }

  function collideBalls(a,b){
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx,dy);
    const min = a.r + b.r;
    if(dist < min && dist>0){
      const nx = dx/dist, ny = dy/dist;
      const overlap = min - dist;
      // separate
      a.x -= nx*(overlap/2);
      a.y -= ny*(overlap/2);
      b.x += nx*(overlap/2);
      b.y += ny*(overlap/2);
      // relative velocity
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
      const relVelAlongNormal = rvx*nx + rvy*ny;
      if(relVelAlongNormal > 0) return;
      const e = 0.9; // restitution
      const j = -(1+e)*relVelAlongNormal / 2;
      const ix = j*nx, iy = j*ny;
      a.vx -= ix; a.vy -= iy;
      b.vx += ix; b.vy += iy;
    }
  }

  // Player controls
  function applyPlayerInput(){
    const s = 0.6;
    if(keys['ArrowLeft'] || keys['KeyA']){ player.vx -= s; playerMovementTimer = 80; }
    if(keys['ArrowRight'] || keys['KeyD']){ player.vx += s; playerMovementTimer = 80; }
    if(keys['Space'] || keys['KeyW'] || keys['ArrowUp']){
      if(player.canJump){ player.vy = -16; player.canJump = false; playerMovementTimer = 80; }
    }

    // (shove feature removed)
  }

  // Simple bot AI
  let botJumpCooldown = 0;
  // track when the player has moved recently so AI doesn't overreact to a standing player
  let playerMovementTimer = 0;
  function botAI(){
    const dx = player.x - bot.x;
    if(Math.abs(dx) > 6){ bot.vx += Math.sign(dx) * 0.3 * difficultyAmplifier; }
    // only jump if player moved recently (or a small random chance), so standing still isn't trivially exploitable
    const playerRecentlyMoved = playerMovementTimer > 0 || Math.abs(player.vx) > 0.5;
    if(bot.canJump && Math.abs(dx) < 140 && botJumpCooldown<=0 && roundStartTimer <= 0 && (playerRecentlyMoved || Math.random() < 0.02)){
      // use the same jump strength as the player
      bot.vy = -16;
      bot.canJump=false;
      botJumpCooldown= Math.max(20, 60 / difficultyAmplifier);
    }
    botJumpCooldown = Math.max(0, botJumpCooldown-1);
    playerMovementTimer = Math.max(0, playerMovementTimer-1);
    roundStartTimer = Math.max(0, roundStartTimer-1);
  }

  // Game loop
  function update(){
    if(state==='playing'){
      applyPlayerInput();
      botAI();
      stepPhysics();
      checkLoseWin();
    }
    render();
    requestAnimationFrame(update);
  }
  requestAnimationFrame(update);

  function checkLoseWin(){
    // If a ball falls off either side (below bottom of canvas) it's lost
    if(player.y - player.r > H){ // player lost
      blueWins++;
      updateScore();
      if(overlays.lose && overlays.lose.querySelector){ overlays.lose.querySelector('h2').textContent = 'you lose!'; }
      if(blueWins >= MAX_WINS){
        gameOver = true;
        if(againLose) againLose.style.display = 'none';
        if(againWin) againWin.style.display = 'none';
        if(playBtn) playBtn.style.display = 'none';
      }
      showOverlay('lose');
    }
    if(bot.y - bot.r > H){ // bot lost
      redWins++;
      updateScore();
      if(overlays.win && overlays.win.querySelector){ overlays.win.querySelector('h2').textContent = 'you win!'; }
      if(redWins >= MAX_WINS){
        gameOver = true;
        if(againLose) againLose.style.display = 'none';
        if(againWin) againWin.style.display = 'none';
        if(playBtn) playBtn.style.display = 'none';
      }
      showOverlay('win');
    }
  }

  function updateScore(){ scoreEl.textContent = `Red: ${redWins} — Blue: ${blueWins}` }

  function render(){
    ctx.clearRect(0,0,W,H);
    // sky gradient
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#87CEEB'); g.addColorStop(1,'#bfe9ff');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

    // platform
    ctx.fillStyle = '#6b4f2e';
    ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
    // platform edges shadow
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(platform.x, platform.y+platform.h, platform.w, 6);

    // draw balls
    [player,bot].forEach(b=>{
      if(!b) return;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
      ctx.fillStyle = b.color; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.stroke();
    });

    // draw center line for platform edges
    ctx.fillStyle='rgba(0,0,0,0.06)';
    ctx.fillRect(platform.x-2, platform.y-60, 2, 60);
    ctx.fillRect(platform.x+platform.w, platform.y-60, 2, 60);
  }

  // ensure platform stays centered on resize
  addEventListener('resize', ()=>{ updatePlatform(); resetBalls(); render(); });

  // initial overlay state
  updateOverlays();
  updateScore();

})();
