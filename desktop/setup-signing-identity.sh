#!/bin/bash
# ONE-TIME, run by you (it adds a certificate to your login keychain).
# Creates a stable self-signed code-signing identity "Chromasmith Local Dev" so install-app.sh can
# sign every rebuild with the SAME identity. macOS keys its privacy grants (external drive,
# Documents, Full Disk Access) to the signing identity; unsigned/ad-hoc builds change identity on
# every rebuild, which is why the "removable volume" prompt reappears each time.
set -euo pipefail
NAME="Chromasmith Local Dev"
if security find-identity -p codesigning | grep -q "$NAME"; then
  echo "Identity '$NAME' already present."; exit 0
fi
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cat > "$T/cert.cnf" <<CNF
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=$NAME
[ext]
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
basicConstraints=critical,CA:false
CNF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$T/k.pem" -out "$T/c.pem" -config "$T/cert.cnf" 2>/dev/null
openssl pkcs12 -export -inkey "$T/k.pem" -in "$T/c.pem" -out "$T/id.p12" -passout pass:chromasmith
security import "$T/id.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P chromasmith -T /usr/bin/codesign
# Trust it for code signing (macOS asks for your password once).
security add-trusted-cert -r trustRoot -p codeSign -k "$HOME/Library/Keychains/login.keychain-db" "$T/c.pem"
echo "Created '$NAME'. Next: ./install-app.sh, then Allow the prompts ONCE (or grant Full Disk Access)."
