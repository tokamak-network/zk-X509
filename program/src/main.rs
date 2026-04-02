//! ZK X.509 Certificate Verification Program (SP1 Guest)
//!
//! Runs inside the zkVM. Verifies:
//! 1. Certificate chain (user cert → intermediate CAs → root CA)
//! 2. User owns the private key corresponding to the certificate
//! 3. All certificates in the chain are temporally valid
//! 4. Certificate is not in the revocation list (CRL)
//! 5. Outputs a nullifier (prevents double registration) and CA root hash

#![no_main]
sp1_zkvm::entrypoint!(main);

use alloy_sol_types::SolType;
use rsa::pkcs8::DecodePublicKey;
use rsa::{Pkcs1v15Sign, RsaPublicKey};
use sha2::{Digest, Sha256};
use x509_parser::prelude::*;
use zk_x509_lib::{PublicValuesStruct, NULLIFIER_DOMAIN};

// ECDSA imports
use p256::ecdsa::{
    signature::hazmat::PrehashVerifier as _,
    Signature as P256Signature,
    VerifyingKey as P256VerifyingKey,
};
use p384::ecdsa::{
    Signature as P384Signature,
    VerifyingKey as P384VerifyingKey,
};

/// Signature algorithm OID bytes (DER-encoded) for direct comparison.
/// Avoids String allocation from to_id_string() — saves cycles in zkVM.
///
/// RSA OIDs: 1.2.840.113549.1.1.x
const OID_BYTES_SHA256_RSA: &[u8] = &[0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x0B];
const OID_BYTES_SHA1_RSA: &[u8]   = &[0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x05];
const OID_BYTES_SHA384_RSA: &[u8] = &[0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x0C];
const OID_BYTES_SHA512_RSA: &[u8] = &[0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x0D];
/// RSA OID prefix: 1.2.840.113549.1.1 (first 8 bytes, without the trailing algorithm byte)
const OID_PREFIX_RSA: &[u8] = &[0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01];

/// ECDSA OIDs: 1.2.840.10045.4.3.x
const OID_BYTES_ECDSA_SHA256: &[u8] = &[0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x04, 0x03, 0x02];
const OID_BYTES_ECDSA_SHA384: &[u8] = &[0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x04, 0x03, 0x03];
/// ECDSA OID prefix: 1.2.840.10045.4
const OID_PREFIX_ECDSA: &[u8] = &[0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x04];

/// EC public key algorithm OID: 1.2.840.10045.2.1
const OID_BYTES_EC_PUB: &[u8] = &[0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01];
/// Named curve OIDs
const OID_BYTES_PRIME256V1: &[u8] = &[0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07]; // P-256
const OID_BYTES_SECP384R1: &[u8] = &[0x2B, 0x81, 0x04, 0x00, 0x22];                     // P-384

/// Verify an RSA signature. Uses stack-allocated digest (no Vec heap alloc).
fn verify_rsa_signature(
    tbs_der: &[u8],
    signature_bytes: &[u8],
    sig_alg_oid_bytes: &[u8],
    signer_pub_key: &RsaPublicKey,
) {
    if sig_alg_oid_bytes == OID_BYTES_SHA256_RSA {
        let hash: [u8; 32] = Sha256::digest(tbs_der).into();
        signer_pub_key.verify(Pkcs1v15Sign::new::<sha2::Sha256>(), &hash, signature_bytes)
            .expect("RSA-SHA256 signature verification failed");
    } else if sig_alg_oid_bytes == OID_BYTES_SHA1_RSA {
        let hash: [u8; 20] = sha1::Sha1::digest(tbs_der).into();
        signer_pub_key.verify(Pkcs1v15Sign::new::<sha1::Sha1>(), &hash, signature_bytes)
            .expect("RSA-SHA1 signature verification failed");
    } else if sig_alg_oid_bytes == OID_BYTES_SHA384_RSA {
        let hash: [u8; 48] = sha2::Sha384::digest(tbs_der).into();
        signer_pub_key.verify(Pkcs1v15Sign::new::<sha2::Sha384>(), &hash, signature_bytes)
            .expect("RSA-SHA384 signature verification failed");
    } else if sig_alg_oid_bytes == OID_BYTES_SHA512_RSA {
        let hash: [u8; 64] = sha2::Sha512::digest(tbs_der).into();
        signer_pub_key.verify(Pkcs1v15Sign::new::<sha2::Sha512>(), &hash, signature_bytes)
            .expect("RSA-SHA512 signature verification failed");
    } else {
        panic!("Unsupported RSA signature algorithm OID");
    }
}

/// Verify an ECDSA signature using the signer's raw SPKI DER public key.
/// Curve is detected from the SPKI's namedCurve OID (not the signature algorithm OID).
/// Digest algorithm is selected from the signature algorithm OID independently.
fn verify_ecdsa_signature(
    tbs_der: &[u8],
    signature_bytes: &[u8],
    sig_alg_oid_bytes: &[u8],
    signer_spki_der: &[u8],
) {
    let ec_point = extract_ec_point_from_spki(signer_spki_der);
    let curve_oid = extract_curve_oid_from_spki(signer_spki_der);

    // Select digest from signature algorithm OID
    if sig_alg_oid_bytes == OID_BYTES_ECDSA_SHA256 {
        let digest: [u8; 32] = Sha256::digest(tbs_der).into();
        verify_ec_with_digest(ec_point, signature_bytes, &digest, curve_oid);
    } else if sig_alg_oid_bytes == OID_BYTES_ECDSA_SHA384 {
        let digest: [u8; 48] = sha2::Sha384::digest(tbs_der).into();
        verify_ec_with_digest(ec_point, signature_bytes, &digest, curve_oid);
    } else {
        panic!("Unsupported ECDSA signature algorithm OID");
    }
}

/// Verify ECDSA signature with a pre-computed digest, selecting curve from SPKI OID.
fn verify_ec_with_digest(
    ec_point: &[u8],
    signature_bytes: &[u8],
    digest: &[u8],
    curve_oid: &[u8],
) {
    if curve_oid == OID_BYTES_PRIME256V1 {
        let vk = P256VerifyingKey::from_sec1_bytes(ec_point)
            .expect("Failed to parse P-256 public key");
        let sig = P256Signature::from_der(signature_bytes)
            .expect("Failed to parse P-256 DER signature");
        vk.verify_prehash(digest, &sig)
            .expect("P-256 ECDSA signature verification failed");
    } else if curve_oid == OID_BYTES_SECP384R1 {
        let vk = P384VerifyingKey::from_sec1_bytes(ec_point)
            .expect("Failed to parse P-384 public key");
        let sig = P384Signature::from_der(signature_bytes)
            .expect("Failed to parse P-384 DER signature");
        vk.verify_prehash(digest, &sig)
            .expect("P-384 ECDSA signature verification failed");
    } else {
        panic!("Unsupported EC curve OID: {:?}", curve_oid);
    }
}

/// Extract the namedCurve OID bytes from an EC SPKI DER structure.
/// SPKI AlgorithmIdentifier for EC = SEQUENCE { ecPublicKey OID, namedCurve OID }
fn extract_curve_oid_from_spki(spki_der: &[u8]) -> &[u8] {
    assert!(spki_der[0] == 0x30, "Expected SEQUENCE tag in SPKI");
    let (_, seq_offset) = der_read_length(&spki_der[1..]);
    let inner = &spki_der[1 + seq_offset..];

    // AlgorithmIdentifier SEQUENCE
    assert!(inner[0] == 0x30, "Expected SEQUENCE for AlgorithmIdentifier");
    let (alg_len, alg_offset) = der_read_length(&inner[1..]);
    let alg_content = &inner[1 + alg_offset..1 + alg_offset + alg_len];

    // First element: algorithm OID (ecPublicKey)
    assert!(alg_content[0] == 0x06, "Expected OID tag for algorithm");
    let (oid_len, oid_offset) = der_read_length(&alg_content[1..]);
    let after_alg_oid = &alg_content[1 + oid_offset + oid_len..];

    // Second element: namedCurve OID (parameters)
    assert!(after_alg_oid[0] == 0x06, "Expected OID tag for namedCurve");
    let (curve_len, curve_offset) = der_read_length(&after_alg_oid[1..]);
    &after_alg_oid[1 + curve_offset..1 + curve_offset + curve_len]
}

/// Extract the EC point bytes from a SubjectPublicKeyInfo DER structure.
/// SPKI = SEQUENCE { algorithm AlgorithmIdentifier, subjectPublicKey BIT STRING }
/// The BIT STRING contains: 0x00 (unused bits) ‖ EC point (0x04 ‖ x ‖ y)
fn extract_ec_point_from_spki(spki_der: &[u8]) -> &[u8] {
    // Minimum valid EC SPKI: ~24 bytes (tag+len+alg+bitstring with compressed point)
    assert!(spki_der.len() >= 24, "SPKI DER too short for EC key");
    assert!(spki_der[0] == 0x30, "Expected SEQUENCE tag in SPKI");
    let (_, seq_offset) = der_read_length(&spki_der[1..]);
    let inner = &spki_der[1 + seq_offset..];

    // Skip AlgorithmIdentifier SEQUENCE
    assert!(inner[0] == 0x30, "Expected SEQUENCE tag for AlgorithmIdentifier");
    let (alg_len, alg_offset) = der_read_length(&inner[1..]);
    let bs = &inner[1 + alg_offset + alg_len..];

    // BIT STRING: tag(0x03) + length + 0x00(unused bits) + EC point
    assert!(bs[0] == 0x03, "Expected BIT STRING tag");
    let (bs_len, bs_offset) = der_read_length(&bs[1..]);
    let bs_content = &bs[1 + bs_offset..1 + bs_offset + bs_len];
    assert!(bs_content[0] == 0x00, "Expected 0 unused bits in BIT STRING");
    &bs_content[1..]
}

/// Read a DER length field. Returns (length_value, bytes_consumed).
fn der_read_length(data: &[u8]) -> (usize, usize) {
    assert!(!data.is_empty(), "DER length field: unexpected end of data");
    if data[0] < 0x80 {
        (data[0] as usize, 1)
    } else {
        let num_bytes = (data[0] & 0x7F) as usize;
        assert!(data.len() >= 1 + num_bytes, "DER length field: truncated long-form length");
        let mut len: usize = 0;
        for i in 0..num_bytes {
            len = (len << 8) | (data[1 + i] as usize);
        }
        (len, 1 + num_bytes)
    }
}

/// Unified signature verification: detects RSA vs ECDSA from the signature algorithm OID bytes.
fn verify_cert_signature(
    tbs_der: &[u8],
    signature_bytes: &[u8],
    sig_alg_oid_bytes: &[u8],
    signer_spki_der: &[u8],
) {
    if sig_alg_oid_bytes.starts_with(OID_PREFIX_RSA) {
        let rsa_pub = RsaPublicKey::from_public_key_der(signer_spki_der)
            .expect("Failed to parse RSA public key from SPKI");
        verify_rsa_signature(tbs_der, signature_bytes, sig_alg_oid_bytes, &rsa_pub);
    } else if sig_alg_oid_bytes.starts_with(OID_PREFIX_ECDSA) {
        verify_ecdsa_signature(tbs_der, signature_bytes, sig_alg_oid_bytes, signer_spki_der);
    } else {
        panic!("Unsupported signature algorithm OID: {:?}", sig_alg_oid_bytes);
    }
}

/// Verify ownership signature: supports both RSA and ECDSA keys.
/// For ECDSA, uses the already-parsed EC point from x509-parser (avoids redundant DER walk).
fn verify_ownership_signature(
    ownership_hash: &[u8; 32],
    ownership_sig: &[u8],
    cert: &X509Certificate,
) {
    let spki = &cert.tbs_certificate.subject_pki;
    let alg_oid_bytes = spki.algorithm.algorithm.as_bytes();

    if alg_oid_bytes == OID_BYTES_EC_PUB {
        // Use x509-parser's already-extracted EC point (no redundant DER walk)
        let ec_point = spki.subject_public_key.data.as_ref();
        // Parse curve OID once, match against known curves
        let curve_params = spki.algorithm.parameters.as_ref()
            .and_then(|p| p.as_oid().ok());
        let is_p256 = curve_params.as_ref()
            .map(|oid| oid.as_bytes() == OID_BYTES_PRIME256V1)
            .unwrap_or(false);

        if is_p256 {
            let vk = P256VerifyingKey::from_sec1_bytes(ec_point)
                .expect("Failed to parse P-256 public key for ownership");
            let sig = P256Signature::from_der(ownership_sig)
                .expect("Failed to parse P-256 ownership signature");
            vk.verify_prehash(ownership_hash, &sig)
                .expect("P-256 ownership signature verification failed");
        } else if curve_params.map(|oid| oid.as_bytes() == OID_BYTES_SECP384R1).unwrap_or(false) {
            let vk = P384VerifyingKey::from_sec1_bytes(ec_point)
                .expect("Failed to parse P-384 public key for ownership");
            let sig = P384Signature::from_der(ownership_sig)
                .expect("Failed to parse P-384 ownership signature");
            vk.verify_prehash(ownership_hash, &sig)
                .expect("P-384 ownership signature verification failed");
        } else {
            panic!("Unsupported EC curve");
        }
    } else {
        let pub_key = RsaPublicKey::from_public_key_der(spki.raw)
            .expect("Failed to parse certificate's RSA public key");
        pub_key
            .verify(Pkcs1v15Sign::new::<sha2::Sha256>(), ownership_hash, ownership_sig)
            .expect("RSA ownership signature verification failed");
    }
}

/// Verify Merkle membership: recompute root from leaf + proof path.
/// Uses sorted-pair hashing: H(min(a,b) ‖ max(a,b)) to prevent second preimage attacks.
fn verify_merkle_membership(leaf: &[u8; 32], proof: &[[u8; 32]]) -> [u8; 32] {
    let mut current = *leaf;
    for sibling in proof {
        let mut hasher = Sha256::new();
        if current <= *sibling {
            hasher.update(current);
            hasher.update(sibling);
        } else {
            hasher.update(sibling);
            hasher.update(current);
        }
        current = hasher.finalize().into();
    }
    current
}

/// Verify CRL Merkle proof with position-aware hashing (NOT sorted-pair).
/// This preserves leaf ordering for non-inclusion adjacency verification.
fn verify_crl_merkle_proof(leaf: &[u8; 32], proof: &[[u8; 32]], directions: &[bool]) -> [u8; 32] {
    let mut current = *leaf;
    for (sibling, &is_left) in proof.iter().zip(directions.iter()) {
        let mut hasher = Sha256::new();
        if is_left {
            hasher.update(current);
            hasher.update(sibling);
        } else {
            hasher.update(sibling);
            hasher.update(current);
        }
        current = hasher.finalize().into();
    }
    current
}

/// Check that a certificate's validity period covers the given timestamp.
fn assert_cert_valid_at(cert: &X509Certificate, ts: i64, label: &str) {
    assert!(
        ts >= cert.validity().not_before.timestamp(),
        "{} is not yet valid", label
    );
    assert!(
        ts <= cert.validity().not_after.timestamp(),
        "{} has expired", label
    );
}

/// OIDs for X.509 subject fields (DER-encoded).
const OID_COUNTRY: &[u8]  = &[0x55, 0x04, 0x06]; // 2.5.4.6
const OID_ORG: &[u8]      = &[0x55, 0x04, 0x0A]; // 2.5.4.10
const OID_ORG_UNIT: &[u8] = &[0x55, 0x04, 0x0B]; // 2.5.4.11
const OID_CN: &[u8]       = &[0x55, 0x04, 0x03]; // 2.5.4.3

/// Extract disclosable fields from X.509 subject as plaintext in bytes32.
/// Disclosure ON  → first value, UTF-8 right-padded to 32 bytes (truncated if >32).
/// Disclosure OFF → bytes32(0).
/// If a field has no value (e.g., individual cert with no Organization), returns bytes32(0).
fn extract_subject_fields(
    subject: &x509_parser::x509::X509Name,
    mask: u8,
) -> ([u8; 32], [u8; 32], [u8; 32], [u8; 32]) {
    let zero: [u8; 32] = [0u8; 32];
    let effective_mask = mask & 0x0F;
    if effective_mask == 0 { return (zero, zero, zero, zero); }

    let mut country_val: Option<&str> = None;
    let mut org_val: Option<&str> = None;
    let mut ou_val: Option<&str> = None;
    let mut cn_val: Option<&str> = None;

    // Single pass: collect the first value for each disclosed field.
    for attr in subject.iter_attributes() {
        let oid_bytes = attr.attr_type().as_bytes();
        if let Ok(value) = attr.as_str() {
            match oid_bytes {
                OID_COUNTRY if (effective_mask & 0x01) != 0 && country_val.is_none() => {
                    country_val = Some(value);
                }
                OID_ORG if (effective_mask & 0x02) != 0 && org_val.is_none() => {
                    org_val = Some(value);
                }
                OID_ORG_UNIT if (effective_mask & 0x04) != 0 && ou_val.is_none() => {
                    ou_val = Some(value);
                }
                OID_CN if (effective_mask & 0x08) != 0 && cn_val.is_none() => {
                    cn_val = Some(value);
                }
                _ => (),
            }
        }
    }

    /// Encode a string value into bytes32: UTF-8 right-padded, truncated at 32 bytes
    /// on a UTF-8 character boundary.
    fn to_bytes32(val: Option<&str>) -> [u8; 32] {
        let mut out = [0u8; 32];
        if let Some(s) = val {
            let mut offset = 0usize;
            for ch in s.chars() {
                let len = ch.len_utf8();
                if offset + len > 32 {
                    break;
                }
                ch.encode_utf8(&mut out[offset..]);
                offset += len;
            }
        }
        out
    }

    let country  = if effective_mask & 0x01 != 0 { to_bytes32(country_val) } else { zero };
    let org      = if effective_mask & 0x02 != 0 { to_bytes32(org_val) } else { zero };
    let org_unit = if effective_mask & 0x04 != 0 { to_bytes32(ou_val) } else { zero };
    let cn       = if effective_mask & 0x08 != 0 { to_bytes32(cn_val) } else { zero };

    (country, org, org_unit, cn)
}

pub fn main() {
    // ========================================
    // Step 1: Read inputs from the host (prover)
    // ========================================
    let cert_der: Vec<u8> = sp1_zkvm::io::read();
    // Signature-based ownership: host signs a challenge with the private key,
    // only the signature enters the ZK circuit. Private key never touches zkVM.
    let ownership_sig: Vec<u8> = sp1_zkvm::io::read();
    // Nullifier signature: Sign(sk, H("zk-X509-Nullifier-v2" ‖ registry_address ‖ chain_id)) — deterministic,
    // registry-specific. Different registries and chains get different nullifiers (cross-DApp unlinkability).
    let nullifier_sig: Vec<u8> = sp1_zkvm::io::read();
    // Chain: [intermediate_ca_certs..., root_ca_pub_key_spki_der]
    // Single-level: [root_ca_pub_key_spki_der]
    let cert_chain: Vec<Vec<u8>> = sp1_zkvm::io::read();
    let current_timestamp: u64 = sp1_zkvm::io::read();
    // CRL: DER-encoded Certificate Revocation List (empty Vec = skip).
    // When provided, the ZK program verifies the CRL's CA signature
    // and checks the user cert serial is not revoked.
    let crl_der: Vec<u8> = sp1_zkvm::io::read();
    // Wallet address that will call register() — binds proof to a specific sender
    let registrant: [u8; 20] = sp1_zkvm::io::read();
    // Wallet index for multi-wallet registration (0 for single-wallet mode)
    let wallet_index: u32 = sp1_zkvm::io::read();
    // Max wallets per cert (verified inside ZK circuit)
    let max_wallets: u32 = sp1_zkvm::io::read();
    // Selective disclosure bitmask: which fields to reveal
    // bit 0 = country (C), bit 1 = org (O), bit 2 = orgUnit (OU), bit 3 = commonName (CN)
    let disclosure_mask: u8 = sp1_zkvm::io::read();
    // Merkle proof for CA anonymity: proves CA membership without revealing which CA
    let ca_merkle_proof: Vec<[u8; 32]> = sp1_zkvm::io::read();
    let ca_merkle_root: [u8; 32] = sp1_zkvm::io::read();
    // Domain separation: registry address + chain ID prevent cross-DApp and cross-chain attacks
    let registry_address: [u8; 20] = sp1_zkvm::io::read();
    let chain_id: u64 = sp1_zkvm::io::read();
    // CRL Merkle Oracle: non-inclusion proof for revocation checking
    // If crl_merkle_root == [0; 32], CRL checking is disabled (legacy mode)
    let crl_merkle_root: [u8; 32] = sp1_zkvm::io::read();
    let crl_left_leaf: [u8; 32] = sp1_zkvm::io::read();
    let crl_right_leaf: [u8; 32] = sp1_zkvm::io::read();
    let crl_left_proof: Vec<[u8; 32]> = sp1_zkvm::io::read();
    let crl_left_dirs: Vec<bool> = sp1_zkvm::io::read();
    let crl_right_proof: Vec<[u8; 32]> = sp1_zkvm::io::read();
    let crl_right_dirs: Vec<bool> = sp1_zkvm::io::read();
    let crl_left_index: u32 = sp1_zkvm::io::read();
    let crl_right_index: u32 = sp1_zkvm::io::read();

    assert!(!cert_chain.is_empty(), "Certificate chain must not be empty");
    assert!(wallet_index < max_wallets, "wallet_index must be < max_wallets");

    let ts = current_timestamp as i64;

    // ========================================
    // Step 2: Parse the user certificate
    // ========================================
    let (_, user_cert) = X509Certificate::from_der(&cert_der)
        .expect("Failed to parse user certificate");

    assert_cert_valid_at(&user_cert, ts, "User certificate");

    // ========================================
    // Step 3: Verify certificate chain
    // ========================================
    // Unified chain verification loop. Avoids duplicate parsing.
    //
    // `signers[i]` verifies `subjects[i]`:
    //   subjects = [user_cert, chain[0], chain[1], ..., chain[n-2]]
    //   signers  = [chain[0],  chain[1], ..., chain[n-2], chain[n-1] (root pub key)]

    let root_ca_pub_key_der = cert_chain.last().unwrap();
    let chain_len = cert_chain.len();

    // Parse all intermediate certs once
    let intermediates: Vec<X509Certificate> = cert_chain[..chain_len - 1]
        .iter()
        .enumerate()
        .map(|(i, der)| {
            let (_, cert) = X509Certificate::from_der(der)
                .unwrap_or_else(|_| panic!("Failed to parse chain certificate [{}]", i));
            assert_cert_valid_at(&cert, ts, "Chain certificate");
            cert
        })
        .collect();

    // Verify user_cert → first signer
    if intermediates.is_empty() {
        // Single-level: root CA directly signed user cert
        verify_cert_signature(
            user_cert.tbs_certificate.as_ref(),
            user_cert.signature_value.as_ref(),
            user_cert.signature_algorithm.algorithm.as_bytes(),
            root_ca_pub_key_der,
        );
    } else {
        // user_cert signed by intermediates[0]
        verify_cert_signature(
            user_cert.tbs_certificate.as_ref(),
            user_cert.signature_value.as_ref(),
            user_cert.signature_algorithm.algorithm.as_bytes(),
            intermediates[0].tbs_certificate.subject_pki.raw,
        );

        // intermediates[i] signed by intermediates[i+1]
        for i in 0..intermediates.len() - 1 {
            verify_cert_signature(
                intermediates[i].tbs_certificate.as_ref(),
                intermediates[i].signature_value.as_ref(),
                intermediates[i].signature_algorithm.algorithm.as_bytes(),
                intermediates[i + 1].tbs_certificate.subject_pki.raw,
            );
        }

        // Last intermediate signed by root CA
        let last = intermediates.last().unwrap();
        verify_cert_signature(
            last.tbs_certificate.as_ref(),
            last.signature_value.as_ref(),
            last.signature_algorithm.algorithm.as_bytes(),
            root_ca_pub_key_der,
        );
    }

    // ========================================
    // Step 4: Check certificate revocation (CRL)
    // ========================================
    // The CRL is verified inside the zkVM:
    //   1. Parse the DER-encoded CRL
    //   2. Assert CRL issuer == user cert issuer (serial numbers are issuer-scoped)
    //   3. Validate CRL freshness (thisUpdate/nextUpdate)
    //   4. Verify the CRL's signature (RSA or ECDSA) using the matching issuer key
    //   5. Check the user cert serial is not in the revoked list
    if !crl_der.is_empty() {
        let (_, crl) = x509_parser::revocation_list::CertificateRevocationList::from_der(&crl_der)
            .expect("Failed to parse CRL");

        // CRL issuer must match the issuer of the user certificate.
        // CRL serial numbers are issuer-scoped: checking a cert's serial
        // against a CRL from a different issuer is meaningless.
        let crl_issuer = crl.issuer();
        let user_issuer = user_cert.issuer();
        assert!(
            crl_issuer == user_issuer,
            "CRL issuer does not match user certificate issuer"
        );

        // Validate CRL freshness: thisUpdate <= timestamp <= nextUpdate
        let crl_this_update = crl.tbs_cert_list.this_update.timestamp();
        assert!(
            crl_this_update <= ts,
            "CRL is not yet valid at the provided timestamp"
        );
        if let Some(next_update) = crl.tbs_cert_list.next_update {
            assert!(
                ts <= next_update.timestamp(),
                "CRL has expired at the provided timestamp"
            );
        }

        // Verify CRL signature using the user cert's issuer key.
        // For multi-level chains: intermediates[0] is the user cert issuer.
        // For single-level: root CA is the issuer.
        let crl_sig_oid_bytes = crl.signature_algorithm.algorithm.as_bytes();

        if let Some(issuer_cert) = intermediates.iter()
            .find(|cert| cert.subject() == crl_issuer)
        {
            verify_cert_signature(
                crl.tbs_cert_list.as_ref(),
                crl.signature_value.as_ref(),
                crl_sig_oid_bytes,
                issuer_cert.tbs_certificate.subject_pki.raw,
            );
        } else {
            // Single-level: CRL signed by root CA. Verify issuer name matches.
            let expected_root_name = user_cert.issuer();
            assert!(
                crl_issuer == expected_root_name,
                "CRL issuer does not match root CA"
            );
            verify_cert_signature(
                crl.tbs_cert_list.as_ref(),
                crl.signature_value.as_ref(),
                crl_sig_oid_bytes,
                root_ca_pub_key_der,
            );
        }

        // Check user cert serial is not revoked
        let user_serial = user_cert.tbs_certificate.serial.to_bytes_be();
        for revoked in crl.iter_revoked_certificates() {
            assert!(
                user_serial != revoked.raw_serial(),
                "Certificate has been revoked"
            );
        }
    }

    // ========================================
    // Step 4b: CRL Merkle Oracle (non-inclusion proof)
    // ========================================
    // If crl_merkle_root != [0; 32], verify that the user's cert serial
    // is NOT in the revoked set via Sorted Merkle Tree non-inclusion proof.
    // This replaces full CRL DER parsing for large-scale CRLs.
    let zero_root: [u8; 32] = [0u8; 32];
    if crl_merkle_root != zero_root {
        let user_serial = user_cert.tbs_certificate.serial.to_bytes_be();
        let serial_hash: [u8; 32] = Sha256::digest(&user_serial).into();

        // Verify ordering: left < serial_hash < right
        assert!(crl_left_leaf < serial_hash, "CRL non-inclusion: serial <= left leaf");
        assert!(serial_hash < crl_right_leaf, "CRL non-inclusion: serial >= right leaf");

        // Verify adjacency
        assert!(crl_right_index == crl_left_index + 1, "CRL non-inclusion: leaves not adjacent");

        // Verify left leaf's Merkle proof (position-aware, NOT sorted-pair)
        let left_root = verify_crl_merkle_proof(&crl_left_leaf, &crl_left_proof, &crl_left_dirs);
        assert!(left_root == crl_merkle_root, "CRL left Merkle proof invalid");

        // Verify right leaf's Merkle proof
        let right_root = verify_crl_merkle_proof(&crl_right_leaf, &crl_right_proof, &crl_right_dirs);
        assert!(right_root == crl_merkle_root, "CRL right Merkle proof invalid");
    }

    // ========================================
    // Step 5: Verify ownership (signature-based)
    // ========================================
    // Host signs challenge = SHA-256(serial ‖ registrant ‖ wallet_index ‖ timestamp ‖ chain_id).
    // Includes chain_id (EIP-155) to prevent cross-chain replay attacks.
    // ZK circuit verifies signature using the cert's public key.
    // Private key never enters the ZK circuit.
    let serial_bytes = user_cert.tbs_certificate.serial.to_bytes_be();

    let mut ownership_hasher = Sha256::new();
    ownership_hasher.update(&serial_bytes);
    ownership_hasher.update(&registrant);
    ownership_hasher.update(&wallet_index.to_be_bytes());
    ownership_hasher.update(&current_timestamp.to_be_bytes());
    ownership_hasher.update(&chain_id.to_be_bytes());
    let ownership_hash: [u8; 32] = ownership_hasher.finalize().into();

    verify_ownership_signature(&ownership_hash, &ownership_sig, &user_cert);

    // ========================================
    // Step 6: Generate Nullifier (signature-based)
    // ========================================
    // Nullifier = SHA-256(nullifier_sig ‖ wallet_index)
    //
    // The nullifier is derived from a deterministic signature of a fixed domain string,
    // NOT from the certificate's public key. This prevents linkability attacks:
    // - Public key is public data (sent to banks, gov, etc.)
    // - Anyone with the cert could compute H(pk ‖ idx) and track the user
    // - With signature-based nullifier, only the private key holder can compute it
    //
    // The nullifier_sig is verified against the cert's public key to ensure
    // it was produced by the legitimate key holder.
    // Domain includes registry_address + chain_id for defense in depth:
    // - registry_address → cross-DApp unlinkability
    // - chain_id → cross-chain unlinkability (redundant with ownership, but defense in depth)
    let mut domain_hasher = Sha256::new();
    domain_hasher.update(NULLIFIER_DOMAIN);
    domain_hasher.update(&registry_address);
    domain_hasher.update(&chain_id.to_be_bytes());
    let nullifier_domain_hash: [u8; 32] = domain_hasher.finalize().into();
    verify_ownership_signature(&nullifier_domain_hash, &nullifier_sig, &user_cert);

    let mut nullifier_hasher = Sha256::new();
    nullifier_hasher.update(&nullifier_sig);
    nullifier_hasher.update(&wallet_index.to_be_bytes());
    let nullifier: [u8; 32] = nullifier_hasher.finalize().into();

    // ========================================
    // Step 7: Verify CA Merkle membership (anonymous CA verification)
    // ========================================
    // Hash the root CA public key, then prove it belongs to the allowed CA set
    // via Merkle proof. Only the Merkle root is committed as a public value,
    // hiding which specific CA issued the certificate.
    let ca_leaf_hash: [u8; 32] = Sha256::digest(root_ca_pub_key_der).into();
    let computed_merkle_root = verify_merkle_membership(&ca_leaf_hash, &ca_merkle_proof);
    assert!(
        computed_merkle_root == ca_merkle_root,
        "CA Merkle membership proof invalid"
    );

    // ========================================
    // Step 8: Commit public values
    // ========================================
    // alloy_sol_types re-exports Address from alloy-primitives via `private` module.
    // Using this path ensures version compatibility with the sol! macro output.
    let registrant_addr = alloy_sol_types::private::Address::from_slice(&registrant);

    let not_after = user_cert.validity().not_after.timestamp() as u64;

    // ========================================
    // Step 9: Selective Disclosure (plaintext in bytes32)
    // ========================================
    // Disclosure ON  → UTF-8 plaintext right-padded to bytes32 (truncated at 32 bytes)
    // Disclosure OFF → bytes32(0)
    let (country_val_b32, org_val_b32, org_unit_val_b32, cn_val_b32) =
        extract_subject_fields(&user_cert.subject(), disclosure_mask);

    let bytes = PublicValuesStruct::abi_encode(&PublicValuesStruct {
        nullifier: nullifier.into(),
        caMerkleRoot: ca_merkle_root.into(),
        timestamp: current_timestamp,
        registrant: registrant_addr,
        walletIndex: wallet_index,
        notAfter: not_after,
        chainId: chain_id,
        registryAddress: alloy_sol_types::private::Address::from_slice(&registry_address),
        crlMerkleRoot: crl_merkle_root.into(),
        country: country_val_b32.into(),
        org: org_val_b32.into(),
        orgUnit: org_unit_val_b32.into(),
        commonName: cn_val_b32.into(),
    });

    sp1_zkvm::io::commit_slice(&bytes);
}
