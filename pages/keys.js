import { useState, useEffect } from 'react';
import Head from 'next/head';
import axios from 'axios';

export default function KeysPage() {
  const [keys, setKeys] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyName, setKeyName] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [uploading, setUploading] = useState(false);
  const [importError, setImportError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [deleteKeyId, setDeleteKeyId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Fetch SSH keys on component mount
  useEffect(() => {
    fetchKeys();
  }, []);

  const fetchKeys = async () => {
    setIsLoading(true);
    try {
      const response = await axios.get('/api/keys');
      setKeys(response.data.keys || []);
    } catch (err) {
      console.error('Failed to fetch SSH keys:', err);
      setError('Failed to load SSH keys. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setImportError('');
    setUploading(true);

    try {
      if (!keyName.trim()) {
        throw new Error('Key name is required');
      }

      if (!privateKey.trim()) {
        throw new Error('Private key is required');
      }

      await axios.post('/api/keys', {
        name: keyName,
        privateKey: privateKey
      });
      
      // Reset form
      setKeyName('');
      setPrivateKey('');
      setShowForm(false);
      
      // Refresh keys list
      fetchKeys();
    } catch (err) {
      console.error('Failed to import SSH key:', err);
      setImportError(err.response?.data?.error || err.message || 'Failed to import SSH key');
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setPrivateKey(event.target.result);
    };
    reader.onerror = () => {
      setImportError('Error reading file');
    };
    reader.readAsText(file);
  };

  const initiateKeyDelete = (keyId) => {
    setDeleteKeyId(keyId);
    setConfirmDelete(true);
  };

  const cancelDelete = () => {
    setDeleteKeyId(null);
    setConfirmDelete(false);
  };

  const confirmKeyDelete = async () => {
    try {
      await axios.delete(`/api/keys?id=${deleteKeyId}`);
      fetchKeys();
    } catch (err) {
      console.error('Failed to delete SSH key:', err);
      setError('Failed to delete SSH key');
    } finally {
      setDeleteKeyId(null);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Head>
        <title>SSH Key Management | Next.js SSH Terminal</title>
      </Head>

      <main className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">SSH Key Management</h1>

        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4">
            <p>{error}</p>
          </div>
        )}

        <div className="bg-white p-6 rounded-lg shadow-md mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Your SSH Keys</h2>
            
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
              >
                Add New Key
              </button>
            )}
          </div>

          {showForm && (
            <div className="bg-gray-50 p-4 rounded-md mb-6">
              <h3 className="text-lg font-medium mb-3">Import SSH Key</h3>
              
              {importError && (
                <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 mb-4">
                  <p>{importError}</p>
                </div>
              )}
              
              <form onSubmit={handleSubmit}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Key Name *
                  </label>
                  <input
                    type="text"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    className="w-full p-2 border rounded-md"
                    placeholder="e.g., My Server Key"
                    required
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    A memorable name to identify this key
                  </p>
                </div>
                
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Private Key *
                  </label>
                  <textarea
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    className="w-full p-2 border rounded-md font-mono text-sm"
                    rows={8}
                    placeholder="-----BEGIN RSA PRIVATE KEY-----..."
                    required
                  ></textarea>
                  <p className="mt-1 text-xs text-gray-500">
                    Paste your private key content here (e.g., the contents of your id_rsa file)
                  </p>
                </div>
                
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Or Upload Key File
                  </label>
                  <input
                    type="file"
                    onChange={handleFileUpload}
                    className="w-full p-2 border rounded-md"
                    accept=".pem,.key,.txt,text/plain"
                  />
                </div>
                
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors flex items-center"
                    disabled={uploading}
                  >
                    {uploading ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Saving...
                      </>
                    ) : (
                      'Save Key'
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-8">
              <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          ) : keys.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-md p-6 text-center">
              <p className="text-gray-600 mb-4">You don't have any SSH keys yet.</p>
              {!showForm && (
                <button
                  onClick={() => setShowForm(true)}
                  className="bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
                >
                  Add Your First Key
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Fingerprint
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Added
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {keys.map((key) => (
                    <tr key={key.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-gray-900">{key.name}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-mono text-gray-600 truncate max-w-xs">
                          {key.fingerprint}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(key.addedAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => initiateKeyDelete(key.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">About SSH Keys</h2>
          
          <div className="space-y-4 text-gray-700">
            <p>
              SSH keys provide a secure way to connect to your servers without using passwords. They work in pairs:
            </p>
            
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Private key</strong> - Stays on your computer and should be kept secure</li>
              <li><strong>Public key</strong> - Gets installed on the server you want to connect to</li>
            </ul>
            
            <p>
              This application only stores your private keys in encrypted form and uses them to establish secure connections.
            </p>
            
            <h3 className="text-lg font-medium mt-4 mb-2">How to generate SSH keys</h3>
            
            <div className="bg-gray-50 p-3 rounded-md font-mono text-sm">
              <p># On macOS or Linux:</p>
              <p>ssh-keygen -t rsa -b 4096 -C "your_email@example.com"</p>
            </div>
            
            <p>
              After generating your key pair, upload the private key here and add the public key to your server's authorized_keys file.
            </p>
            
            <div className="mt-4 text-sm text-gray-500">
              <p>
                <strong>Security note:</strong> Your private keys are encrypted before being stored and are only decrypted during the SSH session. However, for maximum security, consider using SSH keys with passphrases.
              </p>
            </div>
          </div>
        </div>
        
        <div className="mt-6">
          <a
            href="/"
            className="inline-block bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700 transition-colors"
          >
            Back to Home
          </a>
        </div>
      </main>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-medium mb-4">Delete SSH Key</h3>
            <p className="mb-6 text-gray-700">
              Are you sure you want to delete this SSH key? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={cancelDelete}
                className="bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmKeyDelete}
                className="bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}