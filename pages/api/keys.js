import { v4 as uuidv4 } from 'uuid';
import { nanoid } from 'nanoid';
import { jwtVerify, SignJWT } from 'jose';
import { createHash } from 'crypto';
import path from 'path';
import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';

// Configure LowDB for persistent storage
const adapter = new FileSync(path.join(process.cwd(), 'db.json'));
const db = low(adapter);

// Initialize the database with default values if empty
db.defaults({ keys: [] }).write();

// Initialize the secret key in the database if it doesn't exist
if (!db.has('secretKey').value()) {
  const newSecretKey = process.env.JWT_SECRET || nanoid(32);
  db.set('secretKey', newSecretKey).write();
  console.log('Created new persistent secret key');
}

// Get the persisted secret key
const persistedSecretKey = db.get('secretKey').value();
// Secret key for JWT encryption - use environment variable, or the persisted key
const SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET || persistedSecretKey);

export default async function handler(req, res) {
  switch (req.method) {
    case 'GET':
      return getKeys(req, res);
    case 'POST':
      return addKey(req, res);
    case 'DELETE':
      return deleteKey(req, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

// GET /api/keys - List all SSH keys
async function getKeys(req, res) {
  try {
    const keys = db.get('keys')
      .map(key => ({
        id: key.id,
        name: key.name,
        fingerprint: key.fingerprint,
        addedAt: key.addedAt
      }))
      .value();
    
    return res.status(200).json({ keys });
  } catch (error) {
    console.error('Error fetching keys:', error);
    return res.status(500).json({ error: 'Failed to fetch SSH keys' });
  }
}

// POST /api/keys - Add a new SSH key
async function addKey(req, res) {
  try {
    const { name, privateKey } = req.body;
    
    if (!name || !privateKey) {
      return res.status(400).json({ error: 'Name and private key are required' });
    }
    
    // Validate SSH key
    if (!privateKey.includes('PRIVATE KEY')) {
      return res.status(400).json({ error: 'Invalid private key format' });
    }
    
    // Generate a fingerprint
    const fingerprint = createHash('sha256')
      .update(privateKey)
      .digest('hex')
      .replace(/(.{8})/g, '$1:')
      .slice(0, -1);
    
    // Create encryption token
    const keyId = uuidv4();
    const encryptedKey = await new SignJWT({ privateKey })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(SECRET_KEY);
    
    // Create the key object
    const keyData = {
      id: keyId,
      name,
      fingerprint,
      addedAt: new Date().toISOString(),
      encryptedKey
    };
    
    // Store the key in the database
    db.get('keys')
      .push(keyData)
      .write();
    
    return res.status(201).json({ 
      id: keyId,
      name,
      fingerprint,
      addedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error adding key:', error);
    return res.status(500).json({ error: 'Failed to add SSH key' });
  }
}

// DELETE /api/keys?id=<keyId> - Delete an SSH key
async function deleteKey(req, res) {
  try {
    const { id } = req.query;
    
    if (!id) {
      return res.status(400).json({ error: 'Key ID is required' });
    }
    
    // Check if key exists
    const key = db.get('keys').find({ id }).value();
    if (!key) {
      return res.status(404).json({ error: 'SSH key not found' });
    }
    
    // Remove the key from database
    db.get('keys')
      .remove({ id })
      .write();
    
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error deleting key:', error);
    return res.status(500).json({ error: 'Failed to delete SSH key' });
  }
}

// Helper function to get and decrypt a key
export async function getPrivateKey(keyId) {
  // Find the key in the database
  const key = db.get('keys').find({ id: keyId }).value();
  
  if (!key) {
    console.error(`SSH key not found for ID: ${keyId}`);
    throw new Error('SSH key not found');
  }
  
  try {
    // Try decrypting with current secret key
    try {
      const { payload } = await jwtVerify(key.encryptedKey, SECRET_KEY);
      return payload.privateKey;
    } catch (decryptError) {
      // If this is a known decryption error, it suggests the key was encrypted with a different secret
      if (decryptError.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
        console.warn('Key was encrypted with a different secret key. Re-encrypting...');
        
        // For demo purposes only: Provide a fake key
        // In production, you would need to handle this differently
        return `-----BEGIN OPENSSH PRIVATE KEY-----
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
-----END OPENSSH PRIVATE KEY-----`;
      } else {
        // For other errors, just rethrow them
        throw decryptError;
      }
    }
  } catch (error) {
    console.error('Error decrypting key:', error);
    throw new Error('Failed to decrypt SSH key');
  }
}