export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ta', label: 'தமிழ்' },
];

const messages = {
  en: { sosSms: name => `SOS! ${name} needs help. Location:`, safe: "I'M SAFE - Dismiss Alert", emergency: 'EMERGENCY TRIGGERED', responding: "I'm Responding", canHelp: 'I Can Help' },
  hi: { sosSms: name => `SOS! ${name} को मदद चाहिए। स्थान:`, safe: 'मैं सुरक्षित हूँ - अलर्ट बंद करें', emergency: 'आपातकाल सक्रिय', responding: 'मैं मदद के लिए आ रहा/रही हूँ', canHelp: 'मैं मदद कर सकता/सकती हूँ' },
  ta: { sosSms: name => `SOS! ${name}க்கு உதவி தேவை. இருப்பிடம்:`, safe: 'நான் பாதுகாப்பாக இருக்கிறேன்', emergency: 'அவசரநிலை செயல்படுத்தப்பட்டது', responding: 'நான் உதவ வருகிறேன்', canHelp: 'நான் உதவ முடியும்' },
};

export function t(language, key, ...args) {
  const selected = messages[language] || messages.en;
  const value = selected[key] ?? messages.en[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}
