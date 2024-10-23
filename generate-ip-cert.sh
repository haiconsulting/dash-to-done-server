#!/bin/bash

# Default values
DAYS=365
KEY_SIZE=2048
OUT_DIR="certificates"
IP_ADDRESS="127.0.0.1"

# Function to display usage
usage() {
    echo "Usage: $0 [-d days] [-b bits] [-o output_dir] [-ip ip_address]"
    echo "Options:"
    echo "  -d    Certificate validity in days (default: 365)"
    echo "  -b    Key size in bits (default: 2048)"
    echo "  -o    Output directory (default: certificates)"
    echo "  -ip   IP Address (default: 127.0.0.1)"
    exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -d) DAYS="$2"; shift 2 ;;
        -b) KEY_SIZE="$2"; shift 2 ;;
        -o) OUT_DIR="$2"; shift 2 ;;
        -ip) IP_ADDRESS="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown parameter: $1"; usage ;;
    esac
done

# Create output directory if it doesn't exist
mkdir -p "$OUT_DIR"

# Create OpenSSL config file with IP SAN
cat > "$OUT_DIR/openssl.cnf" << EOF
[req]
default_bits = $KEY_SIZE
prompt = no
default_md = sha256
req_extensions = req_ext
distinguished_name = dn
[dn]
C=US
ST=State
L=City
O=Organization
OU=IT
CN=$IP_ADDRESS
[req_ext]
subjectAltName = @alt_names
[alt_names]
IP.1 = $IP_ADDRESS
EOF

# Generate private key
echo "Generating private key..."
openssl genrsa -out "$OUT_DIR/private.key" $KEY_SIZE

if [ $? -ne 0 ]; then
    echo "Error generating private key"
    exit 1
fi

# Generate CSR with the config file
echo "Generating Certificate Signing Request..."
openssl req -new \
    -key "$OUT_DIR/private.key" \
    -out "$OUT_DIR/certificate.csr" \
    -config "$OUT_DIR/openssl.cnf"

if [ $? -ne 0 ]; then
    echo "Error generating CSR"
    exit 1
fi

# Generate self-signed certificate with IP SAN
echo "Generating self-signed certificate..."
openssl x509 -req \
    -days $DAYS \
    -in "$OUT_DIR/certificate.csr" \
    -signkey "$OUT_DIR/private.key" \
    -out "$OUT_DIR/certificate.crt" \
    -extensions req_ext \
    -extfile "$OUT_DIR/openssl.cnf"

if [ $? -ne 0 ]; then
    echo "Error generating certificate"
    exit 1
fi

# Combine certificate and private key into .pem file
echo "Creating combined PEM file..."
cat "$OUT_DIR/certificate.crt" "$OUT_DIR/private.key" > "$OUT_DIR/certificate.pem"

# Verify the certificate
echo "Verifying certificate..."
openssl x509 -in "$OUT_DIR/certificate.crt" -text -noout

# Clean up temporary files
rm "$OUT_DIR/certificate.csr" "$OUT_DIR/openssl.cnf"

echo ""
echo "Certificate generation complete!"
echo "Files created in $OUT_DIR/:"
echo "- private.key    (Private key)"
echo "- certificate.crt (Certificate)"
echo "- certificate.pem (Combined certificate and private key)"