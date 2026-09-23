'use strict';
/* Settings page */

Header.render('settings'); Player.badge();
$('#main').innerHTML = `<div class="page-head"><div><h1>Settings</h1><p class="mute" style="margin:6px 0 0">Changes save automatically and apply to Custom games. Presets on the Play page use their own rules, with your audio, look and song filters.</p></div>
  <a class="btn primary big" href="/game?mode=custom">Start custom game</a></div>
  <div class="panel settings-page" id="setBox"></div>
  <div class="row" style="margin-top:18px;justify-content:flex-end"><a class="btn" href="/play">Back to Play</a><a class="btn primary" href="/game?mode=custom">Start custom game</a></div>`;
SettingsUI.target = $('#setBox');
Lib.init().then(() => SettingsUI.render());
