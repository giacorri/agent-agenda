<script lang="ts">
  import Icon from './Icon.svelte';
  import * as m from '$lib/paraglide/messages';
  import { api } from '$lib/api';
  import { scope } from '$lib/stores/scope';

  // Repo guide for the agent-assisted path.
  const GUIDE_URL = 'https://github.com/giacorri/agent-agenda/blob/main/docs/setup-with-an-agent.md';

  let busy = $state(false);
  // One-click study setup: seed a Study scope + example subjects, then focus it.
  async function useStudent() {
    if (busy) return;
    busy = true;
    try { await api.presetStudent(); scope.set('study'); }
    catch (e) { console.error('agent-agenda: student preset failed', e); }
    finally { busy = false; }
  }
</script>

<section class="firstrun glass">
  <div class="hero">
    <span class="mark"><Icon name="rocket" size={26} /></span>
    <h1>{m.welcome_title()}</h1>
    <p>{m.welcome_body()}</p>
  </div>
  <div class="paths">
    <a class="path" href={GUIDE_URL} target="_blank" rel="noreferrer">
      <span class="pico"><Icon name="bot" size={20} /></span>
      <span class="ptitle">{m.welcome_agent_title()}</span>
      <span class="pbody">{m.welcome_agent_body()}</span>
      <span class="pcta">{m.welcome_agent_cta()} <Icon name="link" size={13} /></span>
    </a>
    <a class="path" href="/onboarding">
      <span class="pico"><Icon name="gear" size={20} /></span>
      <span class="ptitle">{m.welcome_manual_title()}</span>
      <span class="pbody">{m.welcome_manual_body()}</span>
      <span class="pcta">{m.welcome_manual_cta()} <Icon name="expand" size={13} /></span>
    </a>
    <button class="path" onclick={useStudent} disabled={busy}>
      <span class="pico"><Icon name="book" size={20} /></span>
      <span class="ptitle">{m.study_preset_title()}</span>
      <span class="pbody">{m.study_preset_body()}</span>
      <span class="pcta">{m.study_preset_cta()} <Icon name="expand" size={13} /></span>
    </button>
  </div>
</section>

<style>
  .firstrun { display: flex; flex-direction: column; gap: 24px; padding: 32px; max-width: 720px; margin: 24px auto; }
  .hero { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; }
  .mark { display: inline-flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 16px; color: var(--accent); background: var(--accent-dim); border: 1px solid var(--accent-border); }
  .hero h1 { font-size: 24px; font-family: 'Syne', system-ui, sans-serif; }
  .hero p { color: var(--text-secondary); font-size: 14px; max-width: 440px; }
  .paths { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .path { display: flex; flex-direction: column; gap: 7px; padding: 18px; border-radius: 12px; background: var(--bg-glass); border: 1px solid var(--border-glass); text-decoration: none; transition: border-color 0.15s ease, transform 0.15s ease; }
  button.path { font: inherit; text-align: left; cursor: pointer; }
  button.path:disabled { opacity: 0.6; cursor: default; }
  .path:hover { border-color: var(--accent-border); transform: translateY(-2px); }
  .pico { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 10px; color: var(--accent); background: var(--accent-dim); }
  .ptitle { font-size: 15px; font-weight: 700; color: var(--text-primary); }
  .pbody { font-size: 13px; color: var(--text-muted); flex: 1; }
  .pcta { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: var(--accent); font-weight: 600; }
  @media (max-width: 560px) { .paths { grid-template-columns: 1fr; } }
</style>
