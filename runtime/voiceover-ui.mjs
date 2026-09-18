export function voiceoverStudioHtml(token) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Demo Voiceover Studio</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #0b0d12; color: #f6f7fb; }
    main { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(320px, .8fr); min-height: 100vh; }
    .stage { padding: 24px; display: flex; flex-direction: column; gap: 18px; }
    video { width: 100%; max-height: 62vh; background: #000; border-radius: 12px; box-shadow: 0 16px 50px #0009; }
    .prompt { min-height: 180px; display: grid; align-content: center; text-align: center; padding: 24px 8%; background: #151922; border: 1px solid #2a3040; border-radius: 12px; }
    .prompt h1 { color: #8fb8ff; font-size: 15px; letter-spacing: .08em; text-transform: uppercase; margin: 0 0 14px; }
    .prompt p { font-size: clamp(24px, 2.4vw, 42px); line-height: 1.32; margin: 0; }
    .next { color: #9da6b8; margin-top: 16px; font-size: 15px; }
    aside { border-left: 1px solid #252b38; background: #11141b; padding: 22px; overflow: auto; max-height: 100vh; }
    h2 { margin: 0 0 14px; font-size: 20px; }
    button { border: 0; border-radius: 8px; padding: 11px 14px; font-weight: 700; cursor: pointer; background: #2d68d8; color: white; }
    button.secondary { background: #293041; }
    button.danger { background: #9e3040; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .controls { display: flex; flex-wrap: wrap; gap: 9px; }
    label { display: grid; gap: 5px; margin-top: 14px; color: #b9c2d3; font-size: 13px; }
    select { width: 100%; border: 1px solid #343d50; border-radius: 7px; padding: 8px; background: #1b202b; color: white; }
    .meter { height: 10px; background: #242a36; border-radius: 999px; overflow: hidden; margin: 14px 0; }
    .meter > div { height: 100%; width: 0; background: linear-gradient(90deg, #44d287, #f7d154, #ff5d72); transition: width 60ms linear; }
    .status { min-height: 42px; color: #b9c2d3; font-size: 14px; margin: 12px 0; white-space: pre-wrap; }
    .scene { width: 100%; text-align: left; background: #1b202b; margin: 7px 0; border: 1px solid transparent; }
    .scene.selected { border-color: #6da0ff; background: #202b40; }
    .scene small { display: block; color: #9ba5b8; margin-top: 4px; }
    .take { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 0; border-top: 1px solid #252b38; font-size: 12px; }
    .take > span:first-child { flex: 1; min-width: 120px; }
    .take-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    .take button { padding: 6px 9px; font-size: 11px; }
    .pill { display: inline-block; border-radius: 999px; padding: 2px 7px; background: #30384a; margin-left: 6px; }
    .fits { color: #6ee7a8; } .tight { color: #f5cf66; } .over { color: #ff788a; }
    #countdown { position: fixed; inset: 0; display: none; place-items: center; background: #05070bd9; font-size: 22vw; font-weight: 800; z-index: 10; }
    @media (max-width: 900px) { main { grid-template-columns: 1fr; } aside { max-height: none; border-left: 0; border-top: 1px solid #252b38; } }
  </style>
</head>
<body>
  <div id="countdown"></div>
  <main>
    <section class="stage">
      <video id="video" controls muted playsinline></video>
      <div class="prompt">
        <h1 id="prompt-title">Loading voiceover session…</h1>
        <p id="prompt-text"></p>
        <div class="next" id="next-text"></div>
      </div>
    </section>
    <aside>
      <h2>Voiceover studio</h2>
      <div class="controls">
        <button id="record-master">Record full take</button>
        <button id="record-scene" class="secondary">Record selected scene</button>
        <button id="stop" class="danger" disabled>Stop</button>
      </div>
      <label for="microphone">Microphone
        <select id="microphone"><option value="">System default</option></select>
      </label>
      <div class="meter"><div id="meter-value"></div></div>
      <div class="status" id="status">The video is always muted. Allow microphone access when prompted.</div>
      <div id="master"></div>
      <h2>Scenes</h2>
      <div id="scenes"></div>
      <h2>Take history</h2>
      <audio id="take-player" preload="none"></audio>
      <div id="takes"></div>
      <div class="controls" style="margin-top: 18px">
        <button id="complete" class="secondary">Save and close studio</button>
      </div>
    </aside>
  </main>
  <script>
    const token = ${JSON.stringify(token)};
    const withToken = (pathname) =>
      pathname + (pathname.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
    const video = document.getElementById('video');
    const status = document.getElementById('status');
    const stopButton = document.getElementById('stop');
    const recordMaster = document.getElementById('record-master');
    const recordScene = document.getElementById('record-scene');
    const microphone = document.getElementById('microphone');
    const countdown = document.getElementById('countdown');
    const takePlayer = document.getElementById('take-player');
    let session;
    let selectedScene;
    let playingTakeId = null;
    let stream;
    let audioContext;
    let meterFrame;
    let microphonePromise;
    let microphoneGeneration = 0;
    let recorder;
    let chunks = [];
    let recording;
    let preparing = false;
    let stopping = false;
    let uploading = false;
    let stopMonitor;

    video.src = withToken('/video');
    video.muted = true;
    video.volume = 0;
    video.addEventListener('volumechange', () => {
      video.muted = true;
      video.volume = 0;
    });
    video.addEventListener('ratechange', () => {
      if (recording && video.playbackRate !== 1) {
        recording.invalidReason = 'playback speed changed';
      }
      video.playbackRate = 1;
    });
    video.addEventListener('pause', () => {
      if (recording && !stopping && recorder?.state === 'recording') {
        if (!video.ended && video.currentTime < recording.captureEnd) {
          recording.invalidReason = 'locked video playback paused';
        }
        video.play().catch(() => {});
      }
    });
    for (const event of ['waiting', 'stalled']) {
      video.addEventListener(event, () => {
        if (
          recording &&
          !stopping &&
          video.currentTime < recording.captureEnd - 0.05
        ) {
          recording.invalidReason = 'locked video playback stalled';
        }
      });
    }
    video.addEventListener('seeking', () => {
      if (recording && !stopping) {
        recording.invalidReason = 'locked video position changed';
      }
    });

    const format = (seconds) => {
      const value = Math.max(0, Number(seconds) || 0);
      return Math.floor(value / 60) + ':' + String(Math.floor(value % 60)).padStart(2, '0');
    };

    async function refresh() {
      session = await fetch(withToken('/api/session')).then((response) => response.json());
      selectedScene ||= session.prompts[0]?.sceneId;
      render();
      updatePrompt();
    }

    function syncTakePlaybackButtons() {
      const busy = Boolean(preparing || recording || uploading);
      for (const button of document.querySelectorAll('[data-play-take]')) {
        button.disabled =
          busy ||
          (button.dataset.playTake === playingTakeId && !takePlayer.paused);
      }
      for (const button of document.querySelectorAll('[data-stop-take]')) {
        button.disabled =
          busy ||
          button.dataset.stopTake !== playingTakeId ||
          takePlayer.paused;
      }
    }

    function stopTakePlayback(message = null) {
      const stoppedTakeId = playingTakeId;
      takePlayer.pause();
      takePlayer.currentTime = 0;
      playingTakeId = null;
      syncTakePlaybackButtons();
      if (message && stoppedTakeId) status.textContent = message;
    }

    async function playTake(takeId) {
      if (preparing || recording || uploading) return;
      stopTakePlayback();
      const take = session.takes.find((entry) => entry.id === takeId);
      if (!take) throw new Error('The selected take is no longer available');
      playingTakeId = takeId;
      takePlayer.src = withToken(
        '/api/take-audio?takeId=' + encodeURIComponent(takeId),
      );
      syncTakePlaybackButtons();
      try {
        await takePlayer.play();
        status.textContent =
          'Playing ' + (take.kind === 'master' ? 'full take' : take.sceneId) +
          '. Choose Use only after you approve it.';
        syncTakePlaybackButtons();
      } catch (error) {
        playingTakeId = null;
        syncTakePlaybackButtons();
        throw new Error('Could not play take: ' + error.message);
      }
    }

    takePlayer.addEventListener('ended', () => {
      playingTakeId = null;
      takePlayer.currentTime = 0;
      syncTakePlaybackButtons();
      status.textContent = 'Take playback finished. Choose Use to accept it, or record another take.';
    });

    function render() {
      const master = session.takes.find((take) => take.id === session.accepted.master);
      document.getElementById('master').innerHTML = master
        ? '<p>Accepted full take <span class="pill ' + master.fit.status + '">' +
          master.fit.status + ' · ' + master.effectiveDuration.toFixed(1) +
          's</span> <button class="secondary" data-clear-master>Clear full take</button></p>'
        : '<p>No full take accepted. Record one full take, or record every scene.</p>';
      document.getElementById('scenes').innerHTML = session.prompts.map((prompt) => {
        const takeId = session.accepted.scenes[prompt.sceneId];
        const take = session.takes.find((candidate) => candidate.id === takeId);
        const fit = take
          ? '<span class="pill ' + take.fit.status + '">' + take.fit.status + ' · ' +
            take.effectiveDuration.toFixed(1) + '/' + prompt.windowDuration.toFixed(1) + 's</span>'
          : '<span class="pill">not recorded</span>';
        return '<button class="scene ' + (prompt.sceneId === selectedScene ? 'selected' : '') +
          '" data-scene="' + escapeHtml(prompt.sceneId) + '"><strong>' + escapeHtml(prompt.title) +
          '</strong>' + fit + '<small>' + format(prompt.start) + '–' + format(prompt.end) +
          '</small></button>';
      }).join('');
      for (const button of document.querySelectorAll('[data-scene]')) {
        button.addEventListener('click', () => {
          if (preparing || recording || uploading) return;
          stopTakePlayback();
          selectedScene = button.dataset.scene;
          const prompt = session.prompts.find((entry) => entry.sceneId === selectedScene);
          video.currentTime = prompt.start;
          render();
          updatePrompt();
        });
      }
      document.getElementById('takes').innerHTML = [...session.takes].reverse().map((take) => {
        const accepted = take.kind === 'master'
          ? session.accepted.master === take.id
          : session.accepted.scenes[take.sceneId] === take.id;
        const takeId = escapeHtml(take.id);
        return '<div class="take"><span>' +
          escapeHtml(take.kind === 'master' ? 'Full take' : take.sceneId) +
          ' · ' + take.effectiveDuration.toFixed(1) + 's · ' + escapeHtml(take.fit.status) +
          (accepted ? '<span class="pill">in use</span>' : '') +
          '</span><span class="take-actions">' +
          '<button class="secondary" data-play-take="' + takeId + '">Play</button>' +
          '<button class="secondary" data-stop-take="' + takeId + '" disabled>Stop</button>' +
          '<button class="secondary" data-take="' + takeId + '"' +
          (take.fit.status === 'over' || accepted ? ' disabled' : '') +
          '>' + (accepted ? 'In use' : 'Use') + '</button>' +
          (take.kind === 'scene' && accepted
            ? '<button class="secondary" data-clear-scene="' + escapeHtml(take.sceneId) +
              '">Clear scene override</button>'
            : '') + '</span></div>';
      }).join('') || '<p>No takes yet.</p>';
      for (const button of document.querySelectorAll('[data-play-take]')) {
        button.addEventListener('click', () => {
          playTake(button.dataset.playTake).catch((error) => {
            status.textContent = error.message;
          });
        });
      }
      for (const button of document.querySelectorAll('[data-stop-take]')) {
        button.addEventListener('click', () => {
          stopTakePlayback('Take playback stopped. Choose Use to accept it, or record another take.');
        });
      }
      for (const button of document.querySelectorAll('[data-take]')) {
        button.addEventListener('click', async () => {
          if (preparing || recording || uploading) return;
          stopTakePlayback();
          const response = await fetch(withToken('/api/accept'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ takeId: button.dataset.take }),
          });
          if (!response.ok) {
            status.textContent = await response.text();
            return;
          }
          await refresh();
          status.textContent = 'Take accepted for the final human voiceover.';
        });
      }
      for (const button of document.querySelectorAll('[data-clear-master], [data-clear-scene]')) {
        button.addEventListener('click', async () => {
          if (preparing || recording || uploading) return;
          const response = await fetch(withToken('/api/unaccept'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(button.hasAttribute('data-clear-master')
              ? { kind: 'master' }
              : { kind: 'scene', sceneId: button.dataset.clearScene }),
          });
          if (!response.ok) {
            status.textContent = await response.text();
            return;
          }
          await refresh();
        });
      }
      for (const button of document.querySelectorAll('#scenes button, #takes button, #master button')) {
        button.disabled ||= Boolean(preparing || recording || uploading);
      }
      syncTakePlaybackButtons();
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      })[character]);
    }

    function updatePrompt() {
      if (!session) return;
      const time = video.currentTime;
      let index = session.prompts.findIndex((prompt) => time >= prompt.start && time < prompt.end);
      if (index < 0) index = session.prompts.findIndex((prompt) => prompt.start > time);
      if (index < 0) index = session.prompts.length - 1;
      const prompt = session.prompts[index];
      const next = session.prompts[index + 1];
      document.getElementById('prompt-title').textContent = prompt?.title ?? 'Complete';
      document.getElementById('prompt-text').textContent = prompt?.text ?? '';
      document.getElementById('next-text').textContent = next ? 'Next: ' + next.text : '';
    }
    video.addEventListener('timeupdate', updatePrompt);
    video.addEventListener('ended', () => {
      if (recording?.kind === 'master') stopRecording();
    });

    async function ensureMicrophone() {
      if (stream) return stream;
      if (microphonePromise) return microphonePromise;
      const generation = microphoneGeneration;
      const selectedDevice = microphone.value;
      microphone.disabled = true;
      microphonePromise = (async () => {
        const candidate = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(selectedDevice ? { deviceId: { exact: selectedDevice } } : {}),
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (generation !== microphoneGeneration) {
          for (const track of candidate.getTracks()) track.stop();
          throw new Error('Microphone selection changed before access completed');
        }
        stream = candidate;
        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const values = new Uint8Array(analyser.frequencyBinCount);
        const meter = () => {
          analyser.getByteFrequencyData(values);
          const peak = Math.max(...values) / 255;
          document.getElementById('meter-value').style.width = Math.min(100, peak * 150) + '%';
          meterFrame = requestAnimationFrame(meter);
        };
        meter();
        const selected =
          stream.getAudioTracks()[0]?.getSettings().deviceId ?? selectedDevice;
        const devices = await navigator.mediaDevices.enumerateDevices();
        microphone.innerHTML = '<option value="">System default</option>' + devices
          .filter((device) => device.kind === 'audioinput')
          .map((device, index) => '<option value="' + escapeHtml(device.deviceId) + '">' +
            escapeHtml(device.label || 'Microphone ' + (index + 1)) + '</option>')
          .join('');
        microphone.value = selected;
        return stream;
      })().catch((error) => {
        releaseMicrophone();
        throw error;
      });
      try {
        return await microphonePromise;
      } finally {
        microphonePromise = null;
        microphone.disabled = Boolean(preparing || recording || uploading);
      }
    }

    function releaseMicrophone() {
      microphoneGeneration += 1;
      if (meterFrame) cancelAnimationFrame(meterFrame);
      meterFrame = null;
      for (const track of stream?.getTracks() ?? []) track.stop();
      stream = null;
      audioContext?.close().catch(() => {});
      audioContext = null;
      document.getElementById('meter-value').style.width = '0%';
    }

    async function countIn() {
      countdown.style.display = 'grid';
      for (const value of [3, 2, 1]) {
        countdown.textContent = value;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      countdown.style.display = 'none';
    }

    async function beginRecording(kind) {
      if (preparing || recorder?.state === 'recording') return;
      const prompt = session.prompts.find((entry) => entry.sceneId === selectedScene);
      if (kind === 'scene' && !prompt) return;
      try {
        stopTakePlayback();
        preparing = true;
        recordMaster.disabled = true;
        recordScene.disabled = true;
        microphone.disabled = true;
        await ensureMicrophone();
        video.pause();
        video.currentTime = kind === 'master' ? 0 : prompt.start;
        await new Promise((resolve) => {
          if (video.readyState >= 1) resolve();
          else video.addEventListener('loadedmetadata', resolve, { once: true });
        });
        await countIn();
        const preferred = [
          'audio/webm;codecs=opus',
          'audio/mp4',
          'audio/webm',
        ].find((type) => MediaRecorder.isTypeSupported(type));
        recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
        chunks = [];
        recorder.addEventListener('dataavailable', (event) => {
          if (event.data.size) chunks.push(event.data);
        });
        stopping = false;
        video.controls = false;
        const recordingStarted = performance.now();
        recording = {
          kind,
          sceneId: kind === 'scene' ? prompt.sceneId : null,
          videoOffsetMs: 0,
          timelineStart: kind === 'scene' ? prompt.start : 0,
          captureEnd: kind === 'scene' ? prompt.end : session.pictureLock.finalDuration,
          captureDurationMs: 0,
          invalidReason: null,
        };
        recorder.start(250);
        await video.play();
        recording.videoOffsetMs = performance.now() - recordingStarted;
        recorder.addEventListener('stop', uploadRecording, { once: true });
        preparing = false;
        stopButton.disabled = false;
        status.textContent = kind === 'master'
          ? 'Recording full narration. The guide audio is muted.'
          : 'Recording ' + prompt.title + '. Stop naturally before the next scene.';
        stopMonitor = setInterval(() => {
          if (video.currentTime >= recording.captureEnd) stopRecording();
        }, 25);
      } catch (error) {
        recording = null;
        stopping = true;
        if (recorder?.state === 'recording') recorder.stop();
        preparing = false;
        clearInterval(stopMonitor);
        stopMonitor = null;
        countdown.style.display = 'none';
        video.pause();
        video.controls = true;
        microphone.disabled = false;
        recordMaster.disabled = false;
        recordScene.disabled = false;
        throw new Error(
          'Locked video could not start; microphone take was discarded: ' + error.message,
        );
      }
    }

    function stopRecording() {
      if (!recorder || recorder.state !== 'recording') return;
      stopping = true;
      clearInterval(stopMonitor);
      stopMonitor = null;
      if (recording) {
        recording.captureDurationMs = Math.max(
          0,
          (Math.min(video.currentTime, recording.captureEnd) - recording.timelineStart) * 1000,
        );
      }
      video.pause();
      recorder.stop();
      stopButton.disabled = true;
      status.textContent = 'Processing the recorded take…';
    }

    async function uploadRecording() {
      uploading = true;
      const current = recording;
      recording = null;
      if (current.invalidReason) {
        uploading = false;
        stopping = false;
        video.controls = true;
        microphone.disabled = false;
        recordMaster.disabled = false;
        recordScene.disabled = false;
        status.textContent =
          'Take discarded because ' + current.invalidReason + '. Record a clean retake.';
        await refresh().catch((error) => { status.textContent = error.message; });
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });
      const query = new URLSearchParams({
        token,
        kind: current.kind,
        sceneId: current.sceneId ?? '',
        videoOffsetMs: String(current.videoOffsetMs),
        captureDurationMs: String(current.captureDurationMs),
      });
      try {
        const response = await fetch('/api/takes?' + query, {
          method: 'POST',
          headers: { 'content-type': blob.type },
          body: blob,
        });
        if (!response.ok) {
          status.textContent = 'Take failed: ' + await response.text();
        } else {
          const result = await response.json();
          status.textContent = result.eligible
            ? 'Take saved but not selected: ' + result.take.fit.status +
              ' (' + result.take.effectiveDuration.toFixed(1) +
              's). Play it, then choose Use to accept it.'
            : 'Take saved but cannot be used because it is overlong (' +
              result.take.effectiveDuration.toFixed(1) + 's). You can play it before retaking.';
        }
      } catch (error) {
        status.textContent = 'Take failed: ' + error.message;
      } finally {
        uploading = false;
        stopping = false;
        video.controls = true;
        microphone.disabled = false;
        recordMaster.disabled = false;
        recordScene.disabled = false;
        await refresh().catch((error) => { status.textContent = error.message; });
      }
    }

    recordMaster.addEventListener('click', () => beginRecording('master').catch((error) => {
      status.textContent = error.message;
    }));
    recordScene.addEventListener('click', () => beginRecording('scene').catch((error) => {
      status.textContent = error.message;
    }));
    stopButton.addEventListener('click', stopRecording);
    microphone.addEventListener('change', () => {
      if (preparing || recording || uploading || microphonePromise) return;
      releaseMicrophone();
      ensureMicrophone().catch((error) => { status.textContent = error.message; });
    });
    document.getElementById('complete').addEventListener('click', async () => {
      if (preparing || microphonePromise || recorder?.state === 'recording' || uploading) {
        status.textContent = 'Stop and wait for the current take to finish processing.';
        return;
      }
      try {
        const response = await fetch(withToken('/api/complete'), { method: 'POST' });
        if (!response.ok) throw new Error(await response.text());
        releaseMicrophone();
        stopTakePlayback();
        video.pause();
        status.textContent = 'Session saved. You may close this window.';
      } catch (error) {
        status.textContent = 'Could not save session: ' + error.message;
      }
    });

    window.addEventListener('pagehide', () => {
      stopTakePlayback();
      releaseMicrophone();
    });
    refresh().catch((error) => { status.textContent = error.message; });
  </script>
</body>
</html>`;
}
