import React, { useState } from 'react'; // Removed useMemo
// Removed axios import
import {
  ControlledTreeEnvironment,
  Tree,
  StaticTreeDataProvider,
} from 'react-complex-tree';
import 'react-complex-tree/lib/style-modern.css';

// --- Mock Data ---
const mockItems = {
  root: {
    index: 'root',
    isFolder: true,
    children: ['folder1', 'file1.txt'],
    data: 'Mock Root',
  },
  folder1: {
    index: 'folder1',
    isFolder: true,
    children: ['file2.js', 'folder2'],
    data: 'Folder 1',
  },
  'file1.txt': {
    index: 'file1.txt',
    isFolder: false,
    children: [],
    data: 'File 1.txt',
  },
  'file2.js': {
    index: 'file2.js',
    isFolder: false,
    children: [],
    data: 'File 2.js',
  },
  folder2: {
    index: 'folder2',
    isFolder: true,
    children: ['file3.css'],
    data: 'Folder 2',
  },
  'file3.css': {
    index: 'file3.css',
    isFolder: false,
    children: [],
    data: 'File 3.css',
  },
};
// --- End Mock Data ---

export default function FileExplorer({ sessionId }) {
  const [items, setItems] = useState(mockItems);
  // Initialize viewState properly
  const [viewState, setViewState] = useState({});

  // Data provider for the tree (No useMemo)
  console.log("Creating/Updating dataProvider with items:", items);
  const dataProvider = new StaticTreeDataProvider(items);

  console.log("Rendering FileExplorer with mock items state:", items);
  return (
    <div className="p-2 h-full overflow-auto">
      <h3 className="text-sm font-semibold mb-2 border-b pb-1">File Explorer (Mock Data V2)</h3>
      {items && items.root ? (
        <ControlledTreeEnvironment
          items={items} // Pass items directly here as per some examples
          dataProvider={dataProvider} // Keep dataProvider too
          getItemTitle={(item) => item.data}
          // Provide a controlled or structured view state
          viewState={viewState} 
          onPrimaryAction={(item) => setViewState((prev) => ({ ...prev, focusedItem: item.index, selectedItems: [item.index] }))} // Basic interaction
          onExpandItem={(item) => setViewState((prev) => ({ ...prev, expandedItems: [...(prev.expandedItems ?? []), item.index] }))}
          onCollapseItem={(item) => setViewState((prev) => ({ ...prev, expandedItems: (prev.expandedItems ?? []).filter(id => id !== item.index) }))}
        >
          <Tree treeId="file-explorer-tree" rootItem="root" treeLabel="File Explorer" />
        </ControlledTreeEnvironment>
      ) : (
         <p className="text-xs text-gray-500">Error: Mock data is missing.</p>
      )}
    </div>
  );
}
