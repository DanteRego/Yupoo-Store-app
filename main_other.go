//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

// On Mac/Linux there is no app window: the library opens in your normal browser
// (auto-saving while browsing only works in the Windows app).
func main() {
	app, err := StartApp()
	if err != nil {
		fmt.Println("Kit Library couldn't start:", err)
		os.Exit(1)
	}
	fmt.Println("Kit Library is running at", app.baseURL)
	fmt.Println("TOKEN", app.token)
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	<-c
	_ = app.lib.Flush()
}
