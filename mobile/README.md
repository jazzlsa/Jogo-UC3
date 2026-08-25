# mobile/ — Android (.apk) via Capacitor

Empacota exatamente os mesmos arquivos de [`app/src/`](../app/src) (veja
`webDir` em `capacitor.config.json`) como um app Android instalável via
`.apk` — sem loja, sem conta de desenvolvedor, 100% gratuito. Não inclui iOS
de propósito (precisaria de Mac + Xcode + conta Apple paga).

`android/` é gerado por `npx cap add android` e fica fora do git (git-ignorado
— é reconstruído a qualquer momento com `npx cap sync android`).

## Setup (uma vez)

Precisa do [Android Studio](https://developer.android.com/studio) instalado
(só pra ter o Android SDK/Gradle — não precisa abrir o Android Studio em si
pra buildar).

```
cd mobile
npm install
npx cap add android
```

## Build local (debug, pra testar rápido)

```
npx cap sync android
cd android
gradlew.bat assembleDebug
```

O `.apk` fica em `android/app/build/outputs/apk/debug/app-debug.apk`. Um APK
debug já instala num Android com "fontes desconhecidas" ativado, mas não é o
que sobe na Release — isso é só pra testar.

## Gerar a keystore de release (uma vez, gratuito)

Precisa do JDK instalado (vem com o Android Studio). Gera um arquivo de
assinatura local — nunca vai pro git:

```
keytool -genkeypair -v -keystore uc3-release.keystore -alias uc3 -keyalg RSA -keysize 2048 -validity 10000
```

Guarde a senha que você definir. Esse arquivo `uc3-release.keystore` (e a
senha) são o que autoriza builds de release assinados — sem eles não dá pra
gerar um APK de release novo, então guarde num lugar seguro.

Pra usar no GitHub Actions (build automático), converta pra base64 e cadastre
como *secrets* do repositório (Settings → Secrets and variables → Actions):

```
certutil -encode uc3-release.keystore keystore-base64.txt   # Windows
```

- `ANDROID_KEYSTORE_BASE64` — conteúdo de `keystore-base64.txt`
- `ANDROID_KEYSTORE_PASSWORD` — a senha que você definiu
- `ANDROID_KEY_ALIAS` — `uc3` (ou o alias que você usou)

## Build de release assinado, local

```
npx cap sync android
cd android
gradlew.bat assembleRelease -Pandroid.injected.signing.store.file=..\uc3-release.keystore -Pandroid.injected.signing.store.password=SUA_SENHA -Pandroid.injected.signing.key.alias=uc3 -Pandroid.injected.signing.key.password=SUA_SENHA
```

O `.apk` assinado fica em `android/app/build/outputs/apk/release/app-release.apk`
— esse é o que dá pra distribuir direto (o usuário precisa ativar "instalar de
fontes desconhecidas" no Android pra abrir um APK que não veio da Play Store).

O job `android` do GitHub Actions (`.github/workflows/build-release.yml`) faz
esse mesmo build automaticamente a cada Release, usando os secrets acima.
