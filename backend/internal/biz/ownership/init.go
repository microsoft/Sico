package ownership

import "github.com/google/wire"

var ProviderSet = wire.NewSet(NewResolver)
