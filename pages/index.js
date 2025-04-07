import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-100">
      <Head>
        <title>Next.js SSH Terminal</title>
        <meta name="description" content="Secure SSH terminal access via browser" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="container mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold text-center mb-8">
          Browser-based SSH Terminal
        </h1>
        
        <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow-md">
          <p className="mb-6 text-gray-700">
            Connect securely to your Linux servers directly from your browser with full terminal functionality.
          </p>
          
          <div className="flex flex-col space-y-4">
            <Link 
              href="/terminal" 
              className="bg-blue-600 text-white py-3 px-6 rounded-md text-center hover:bg-blue-700 transition duration-200"
            >
              Launch Terminal
            </Link>
            
            <Link 
              href="/keys" 
              className="bg-gray-600 text-white py-3 px-6 rounded-md text-center hover:bg-gray-700 transition duration-200"
            >
              Manage SSH Keys
            </Link>
          </div>

          <div className="mt-8 border-t pt-6">
            <h2 className="text-xl font-semibold mb-4">Features</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Secure SSH connections from your browser</li>
              <li>Upload and manage SSH private keys</li>
              <li>Full terminal emulation with Xterm.js</li>
              <li>Responsive design for any device</li>
              <li>Session persistence</li>
              <li>Command history and logging</li>
            </ul>
          </div>
        </div>
      </main>

      <footer className="text-center py-8 text-gray-500">
        <p>© {new Date().getFullYear()} Next.js SSH Terminal</p>
      </footer>
    </div>
  );
}
