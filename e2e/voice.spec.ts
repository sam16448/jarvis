import { expect, test, type Page } from '@playwright/test';
import { open } from './helpers';

/** Replace the browser's speech engine with a recorder. */
async function recordSpeech(page: Page) {
  await page.addInitScript(() => {
    const said: string[] = [];
    (window as unknown as { __said: string[] }).__said = said;
    class U { text: string; voice: unknown; lang = ''; rate = 1; volume = 1; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t; } }
    const synth = {
      speak(u: U) { if (u.text.trim()) said.push(u.text); setTimeout(() => u.onend?.(), 5); },
      cancel() {}, getVoices: () => [{ name: 'Daniel', lang: 'en-GB', voiceURI: 'daniel' }],
      addEventListener() {}, removeEventListener() {},
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = U;
  });
}
const said = (page: Page) => page.evaluate(() => (window as unknown as { __said: string[] }).__said.join(' '));

test('Jarvis answers out loud and "yes" applies the change', async ({ page }) => {
  await recordSpeech(page);
  await open(page);
  const input = page.getByRole('textbox', { name: 'Speak or type' });
  await input.fill('Add gym at 7 pm today');
  await input.press('Enter');
  await expect.poll(() => said(page)).toMatch(/boss\..*Gym.*Shall I go ahead\?/);
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('textbox', { name: 'Reply' }).fill('yes');
  await dlg.getByRole('textbox', { name: 'Reply' }).press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.tl-item', { hasText: 'Gym' })).toHaveCount(1);
  await expect.poll(() => said(page)).toMatch(/Done|done|All set|Sorted/);
});

test('saying "no" cancels without changes', async ({ page }) => {
  await recordSpeech(page);
  await open(page);
  const input = page.getByRole('textbox', { name: 'Speak or type' });
  await input.fill('Add gym at 7 pm today');
  await input.press('Enter');
  const reply = page.getByRole('dialog').getByRole('textbox', { name: 'Reply' });
  await reply.fill('no');
  await reply.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.tl-item', { hasText: 'Gym' })).toHaveCount(0);
});

test('morning brief: Gemini writes it, weather included, Jarvis reads it', async ({ page }) => {
  await recordSpeech(page);
  let prompt = '';
  await page.route('https://generativelanguage.googleapis.com/**', async route => {
    prompt = route.request().postData() ?? '';
    await route.fulfill({ json: { candidates: [{ content: { parts: [{ text: 'Good morning, boss. London is wearing its rain coat today, so should you.' }] } }] } });
  });
  await page.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ json: { results: [{ name: 'London', latitude: 18.52, longitude: 73.86 }] } }));
  await page.route('https://api.open-meteo.com/**', route => route.fulfill({ json: {
    current: { temperature_2m: 24, weather_code: 61 },
    daily: { time: ['2026-10-12'], weather_code: [61], temperature_2m_max: [28], temperature_2m_min: [21], precipitation_probability_max: [70] },
  } }));
  await open(page, '2026-10-12T07:00', '/settings');
  // AI key + weather city
  await page.getByRole('combobox', { name: 'Provider' }).selectOption('gemini');
  await page.getByLabel('API key').fill('test-key-not-real');
  await page.getByLabel('API key').blur();
  await page.getByRole('textbox', { name: 'City' }).fill('London');
  await page.getByRole('button', { name: 'Set', exact: true }).click();
  await expect(page.getByText('Current: London')).toBeVisible();
  await page.getByRole('button', { name: 'Morning brief' }).click();
  const brief = page.getByRole('dialog', { name: 'Morning brief' });
  await expect(brief).toContainText('rain coat');
  await expect(brief).toContainText('London: rain');
  await expect.poll(() => said(page)).toContain('rain coat');
  expect(prompt).toContain('JARVIS');
  const facts = JSON.parse(JSON.parse(prompt).contents[0].parts[0].text);
  expect(facts.weather).toMatchObject({ place: 'London', summary: 'rain', highC: 28 });
  await page.screenshot({ path: 'shots/brief-voice.png' });
});

/** Fake speech recognition: either "hears" a phrase or fails with an error. */
async function fakeRecognition(page: Page, mode: { text: string } | { error: string }) {
  await page.addInitScript((m) => {
    class FakeSR {
      lang = ''; interimResults = false; continuous = false; maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null; onend: (() => void) | null = null; onerror: ((e: unknown) => void) | null = null; onstart = null;
      start() {
        setTimeout(() => {
          if ('error' in m) { this.onerror?.({ error: m.error }); this.onend?.(); return; }
          const r = [[{ transcript: m.text }]] as unknown as { isFinal: boolean }[];
          this.onresult?.({ results: r });
          this.onend?.();
        }, 30);
      }
      stop() {} abort() {}
    }
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeSR;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSR;
  }, mode);
}

test('tap-to-talk hears a command and sends it', async ({ page }) => {
  await recordSpeech(page);
  await fakeRecognition(page, { text: 'Add gym at 7 pm today' });
  await open(page);
  await page.getByRole('button', { name: 'Tap to talk' }).click();
  await expect(page.getByRole('dialog')).toContainText('Gym');
  await expect.poll(() => said(page)).toMatch(/Shall I go ahead\?/);
});

test('blocked microphone explains the keyboard mic and hides the button', async ({ page }) => {
  await fakeRecognition(page, { error: 'service-not-allowed' });
  await open(page);
  await page.getByRole('button', { name: 'Tap to talk' }).click();
  await expect(page.getByRole('status')).toContainText('mic on the keyboard');
  await expect(page.getByRole('button', { name: 'Tap to talk' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Speak or type' })).toBeFocused();
});
