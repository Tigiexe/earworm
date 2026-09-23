'use strict';
/* Settings page: what applies to every game. Each game mode's own rules live on that mode's start screen. */
Header.render('settings'); Player.badge();
$('#main').innerHTML = `<div class="page-head"><div><h1>Settings</h1><p class="mute" style="margin:6px 0 0">These apply to every game. Rules like the number of songs, time per song and points belong to each game mode — change them when you open the mode.</p></div>
  <a class="btn" href="/game?mode=custom">🎛️ Custom game</a></div>
  <div class="panel settings-page" id="setBox"></div>
  <div class="row" style="margin-top:18px;justify-content:flex-end"><a class="btn" href="/play">Back to Play</a></div>`;
Lib.init().then(() => SettingsUI.open($('#setBox')));
