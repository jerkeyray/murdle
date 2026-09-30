// Package config reads process configuration, including a local .env file.
package config

import (
	"bufio"
	"os"
	"strings"
)

// LoadDotenv reads KEY=VALUE lines from path into the environment, without
// overwriting anything already set.
//
// Deliberately minimal — no export keyword, no interpolation, no multi-line
// values. It exists so a fresh clone runs with one file and no exports, while
// a real deployment sets real environment variables instead.
//
// A missing file is not an error: production has no .env.
func LoadDotenv(path string) error {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}

		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)

		if _, already := os.LookupEnv(key); !already {
			_ = os.Setenv(key, value)
		}
	}

	return scanner.Err()
}

// Env returns the value of key, or fallback when it is unset or empty.
func Env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
