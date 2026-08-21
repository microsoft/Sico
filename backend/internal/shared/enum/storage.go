package enum

type StorageType int

const (
	StorageTypeUnknown StorageType = iota
	StorageTypeSeaweedFS
	StorageTypeAzureBlob
)

func (s StorageType) String() string {
	switch s {
	case StorageTypeUnknown:
		return "unknown"
	case StorageTypeSeaweedFS:
		return "seaweedfs"
	case StorageTypeAzureBlob:
		return "azure_blob"
	default:
		return "unknown"
	}
}
