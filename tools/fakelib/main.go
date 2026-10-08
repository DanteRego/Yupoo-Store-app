// fakelib makes a test library.json of any size from a real one, for speed testing:
//
//	go run ./tools/fakelib -from "%APPDATA%\YupooLibrary\library.json" -n 100000 -out C:\temp\fake\library.json
//
// Items are copies of real ones (so titles, stores and categories look real) with new album numbers.
// It only reads the real library; it never changes it.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strconv"
)

func main() {
	from := flag.String("from", "", "real library.json to copy items from")
	n := flag.Int("n", 10000, "how many items the test library should have")
	out := flag.String("out", "", "where to write the test library.json")
	flag.Parse()
	if *from == "" || *out == "" {
		flag.Usage()
		os.Exit(2)
	}
	b, err := os.ReadFile(*from)
	if err != nil {
		panic(err)
	}
	var lib map[string]json.RawMessage
	if err := json.Unmarshal(b, &lib); err != nil {
		panic(err)
	}
	var albums map[string]map[string]interface{}
	if err := json.Unmarshal(lib["albums"], &albums); err != nil {
		panic(err)
	}
	src := make([]map[string]interface{}, 0, len(albums))
	for _, a := range albums {
		src = append(src, a)
	}
	r := rand.New(rand.NewSource(1))
	r.Shuffle(len(src), func(i, j int) { src[i], src[j] = src[j], src[i] })
	outAlbums := map[string]map[string]interface{}{}
	for i := 0; i < *n; i++ {
		a := map[string]interface{}{}
		for k, v := range src[i%len(src)] {
			a[k] = v
		}
		if i >= len(src) { // a copy: give it its own album number
			id := strconv.Itoa(900000000 + i)
			host, _ := a["host"].(string)
			a["id"], a["key"] = id, host+":"+id
		}
		delete(a, "newAt")
		outAlbums[a["key"].(string)] = a
	}
	ab, _ := json.Marshal(outAlbums)
	lib["albums"] = ab
	delete(lib, "newCheck") // so the test app doesn't think it has checked these stores
	delete(lib, "storeFill")
	delete(lib, "storeTotals")
	ob, _ := json.Marshal(lib)
	_ = os.MkdirAll(filepath.Dir(*out), 0o755)
	if err := os.WriteFile(*out, ob, 0o644); err != nil {
		panic(err)
	}
	fmt.Printf("wrote %d items (%.1f MB) to %s\n", len(outAlbums), float64(len(ob))/(1<<20), *out)
}
