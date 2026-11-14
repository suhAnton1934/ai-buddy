
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "jsdom",
        include: ["tests/**/*.test.js"],
        coverage: {
            provider: "v8",
            include: ["frontend/**/*.js"],
            exclude: ["**/*.test.js"],
            reporter: ["text", "html"]
        }
    }
});
