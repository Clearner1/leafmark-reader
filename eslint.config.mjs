import obsidianmd from "eslint-plugin-obsidianmd";
export default [...obsidianmd.configs.recommended, {files:["src/**/*.ts"], languageOptions:{parserOptions:{project:"./tsconfig.json",tsconfigRootDir:import.meta.dirname}}}, {ignores:["dist/**", "tests/**", "*.mjs"]}];
