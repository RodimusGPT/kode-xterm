# CLAUDE.md - Next.js SSH Terminal

## Build Commands
- `npm run dev` - Start Next.js development server
- `npm run server` - Start SSH/terminal server
- `npm run dev:all` - Start both Next.js and terminal server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint 

## Code Style
- **Imports**: Group by external/internal, sort alphabetically
- **JS/React**: Use functional components with hooks
- **Naming**: camelCase for variables/functions, PascalCase for components
- **Formatting**: 2-space indentation, semi-colons required
- **Error Handling**: Use try/catch with specific error messages

## Structure
- NextJS pages in `/pages`
- Terminal components in `/components`
- Server-side code in `/server`
- API endpoints in `/pages/api`
- CSS modules in `/styles`
- Transcript handling in `/utils`

## Tools
- TailwindCSS for styling
- Axios for HTTP requests
- Socket.io/WebSockets for real-time communication
- Xterm.js for terminal emulation