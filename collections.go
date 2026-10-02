package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

// The Catalog: your own collections of saved items (e.g. "Wishlist"), each with an
// optional note per item (size, quantity…). Stored in library.json under "collections".

type Collection struct {
	ID      string           `json:"id"`
	Name    string           `json:"name"`
	Items   []CollectionItem `json:"items"`
	Created int64            `json:"created"`
}

type CollectionItem struct {
	Key   string `json:"key"`   // the saved item (same key as in "albums")
	Added int64  `json:"added"` // when it was added to this collection
	Note  string `json:"note,omitempty"`
}

// CollectionRequest is what the Catalog and Library pages send.
type CollectionRequest struct {
	ID   string   `json:"id"`
	Name string   `json:"name"`
	Keys []string `json:"keys"`
	Key  string   `json:"key"`
	Note string   `json:"note"`
}

func newCollectionID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "c" + hex.EncodeToString(b)
}

func cleanName(s string, max int) string {
	s = strings.TrimSpace(strings.Join(strings.Fields(s), " "))
	if r := []rune(s); len(r) > max {
		s = string(r[:max])
	}
	return s
}

func (l *Library) findCollection(id string) *Collection {
	for _, c := range l.data.Collections {
		if c.ID == id {
			return c
		}
	}
	return nil
}

// addToCollection adds keys that are saved items and not already in the collection.
func (l *Library) addToCollection(c *Collection, keys []string) int {
	have := map[string]bool{}
	for _, it := range c.Items {
		have[it.Key] = true
	}
	now, n := time.Now().UnixMilli(), 0
	for _, k := range keys {
		if have[k] || l.data.Albums[k] == nil {
			continue
		}
		have[k] = true
		c.Items = append(c.Items, CollectionItem{Key: k, Added: now})
		n++
	}
	return n
}

func removeFromCollection(c *Collection, keys []string) int {
	drop := map[string]bool{}
	for _, k := range keys {
		drop[k] = true
	}
	kept := c.Items[:0]
	for _, it := range c.Items {
		if !drop[it.Key] {
			kept = append(kept, it)
		}
	}
	n := len(c.Items) - len(kept)
	c.Items = kept
	return n
}

// CollectionAction makes one change: create, rename, delete, add, remove or note.
// It returns the changed collection (nil after delete) and how many items it touched.
func (l *Library) CollectionAction(act string, in CollectionRequest) (*Collection, int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if act == "create" {
		name := cleanName(in.Name, 80)
		if name == "" {
			return nil, 0, errors.New("give the collection a name")
		}
		c := &Collection{ID: newCollectionID(), Name: name, Items: []CollectionItem{}, Created: time.Now().UnixMilli()}
		n := l.addToCollection(c, in.Keys)
		l.data.Collections = append(l.data.Collections, c)
		l.scheduleSave()
		return c, n, nil
	}
	c := l.findCollection(in.ID)
	if c == nil {
		return nil, 0, errors.New("that collection doesn't exist any more")
	}
	n := 0
	switch act {
	case "rename":
		name := cleanName(in.Name, 80)
		if name == "" {
			return nil, 0, errors.New("give the collection a name")
		}
		c.Name = name
	case "delete":
		kept := l.data.Collections[:0]
		for _, x := range l.data.Collections {
			if x.ID != c.ID {
				kept = append(kept, x)
			}
		}
		l.data.Collections = kept
		l.scheduleSave()
		return nil, len(c.Items), nil
	case "add":
		n = l.addToCollection(c, in.Keys)
	case "remove":
		n = removeFromCollection(c, in.Keys)
	case "note":
		for i := range c.Items {
			if c.Items[i].Key == in.Key {
				c.Items[i].Note = strings.TrimSpace(in.Note)
				if r := []rune(c.Items[i].Note); len(r) > 500 {
					c.Items[i].Note = string(r[:500])
				}
				n = 1
			}
		}
	default:
		return nil, 0, errors.New("unknown collection action")
	}
	l.scheduleSave()
	return c, n, nil
}

func (l *Library) CollectionsList() []*Collection {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]*Collection, len(l.data.Collections))
	for i, c := range l.data.Collections {
		cp := *c
		cp.Items = append([]CollectionItem{}, c.Items...)
		out[i] = &cp
	}
	return out
}

// mergeCollections adds a backup's collections: new ones are added, ones you already
// have get any items they were missing. Called with l.mu held.
func (l *Library) mergeCollections(incoming []*Collection) {
	for _, in := range incoming {
		if in == nil || in.ID == "" {
			continue
		}
		if c := l.findCollection(in.ID); c != nil {
			have := map[string]bool{}
			for _, it := range c.Items {
				have[it.Key] = true
			}
			for _, it := range in.Items {
				if !have[it.Key] {
					c.Items = append(c.Items, it)
				}
			}
			continue
		}
		if in.Items == nil {
			in.Items = []CollectionItem{}
		}
		l.data.Collections = append(l.data.Collections, in)
	}
}

// forgetInCollections takes removed items out of every collection. Called with l.mu held.
func (l *Library) forgetInCollections(keys []string) {
	for _, c := range l.data.Collections {
		removeFromCollection(c, keys)
	}
}
