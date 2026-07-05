#[cfg(windows)]
use windows::Win32::Foundation::LocalFree;
#[cfg(windows)]
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

use crate::error::{CoreError, Result};

/// Encrypt data using Windows DPAPI (user-scoped).
pub fn encrypt_bytes(plaintext: &[u8]) -> Result<Vec<u8>> {
    #[cfg(windows)]
    {
        let input = CRYPT_INTEGER_BLOB {
            cbData: plaintext.len() as u32,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptProtectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .map_err(|e| CoreError::Crypto(format!("CryptProtectData failed: {e}")))?;
            let encrypted =
                std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            let _ = LocalFree(windows::Win32::Foundation::HLOCAL(output.pbData as _));
            Ok(encrypted)
        }
    }
    #[cfg(not(windows))]
    {
        Err(CoreError::Crypto(
            "DPAPI only available on Windows".to_string(),
        ))
    }
}

/// Decrypt data using Windows DPAPI.
pub fn decrypt_bytes(ciphertext: &[u8]) -> Result<Vec<u8>> {
    #[cfg(windows)]
    {
        let input = CRYPT_INTEGER_BLOB {
            cbData: ciphertext.len() as u32,
            pbData: ciphertext.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .map_err(|e| CoreError::Crypto(format!("CryptUnprotectData failed: {e}")))?;
            let decrypted =
                std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            let _ = LocalFree(windows::Win32::Foundation::HLOCAL(output.pbData as _));
            Ok(decrypted)
        }
    }
    #[cfg(not(windows))]
    {
        Err(CoreError::Crypto(
            "DPAPI only available on Windows".to_string(),
        ))
    }
}

pub fn encrypt_string(plaintext: &str) -> Result<Vec<u8>> {
    encrypt_bytes(plaintext.as_bytes())
}

pub fn decrypt_string(ciphertext: &[u8]) -> Result<String> {
    let bytes = decrypt_bytes(ciphertext)?;
    String::from_utf8(bytes).map_err(|e| CoreError::Crypto(format!("Invalid UTF-8: {e}")))
}
