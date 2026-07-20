import { createI18n } from 'vue-i18n';
import en from './en.js'
import zh from './zh.js'
import ru from './ru.js'
const i18n = createI18n({
    legacy: false,
    messages: {
        zh,
        en,
        ru
    },
});

export default i18n;
