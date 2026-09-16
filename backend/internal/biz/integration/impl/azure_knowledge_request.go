package impl

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/errcode"
	integrationdto "sico-backend/internal/transport/http/dto/integration"
	"sico-backend/pkg/logger"
)

const knowledgeImportRequestTTL = 24 * time.Hour

type knowledgeImportClaim struct {
	Key         string `json:"-"`
	Fingerprint string `json:"fingerprint"`
	Response    *integrationdto.ImportAzureDevOpsKnowledgeResponse `json:"response,omitempty"`
}

func (s *Service) claimKnowledgeImport(
	ctx context.Context,
	req *integrationdto.ImportAzureDevOpsKnowledgeRequest,
	actor string,
) (*knowledgeImportClaim, *integrationdto.ImportAzureDevOpsKnowledgeResponse, error) {
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, nil, err
	}
	identity := fmt.Sprintf("%d\n%s\n%s", req.Export.SicoProjectId, actor, req.RequestId)
	claim := &knowledgeImportClaim{
		Key: "integration:ado:knowledge:" + fmt.Sprintf("%x", sha256.Sum256([]byte(identity))),
		Fingerprint: fmt.Sprintf("%x", sha256.Sum256(payload)),
	}
	encoded, err := json.Marshal(claim)
	if err != nil {
		return nil, nil, err
	}
	err = s.Cache.SetArgs(ctx, claim.Key, encoded, redis.SetArgs{Mode: "NX", TTL: knowledgeImportRequestTTL}).Err()
	if err == nil {
		return claim, nil, nil
	}
	if !errors.Is(err, redis.Nil) {
		return nil, nil, err
	}
	existing, err := s.Cache.Get(ctx, claim.Key).Bytes()
	if err != nil {
		return nil, nil, err
	}
	var previous knowledgeImportClaim
	if err := json.Unmarshal(existing, &previous); err != nil {
		return nil, nil, err
	}
	if previous.Fingerprint != claim.Fingerprint {
		return nil, nil, apperr.New(errcode.CommonConflict, "requestId was already used with different import parameters")
	}
	if previous.Response != nil {
		return claim, previous.Response, nil
	}
	return nil, nil, apperr.New(errcode.CommonConflict,
		"Import is processing or uncertain. Check Project Knowledge; retry the same request to retrieve its receipt.")
}

func (s *Service) completeKnowledgeImport(
	ctx context.Context,
	claim *knowledgeImportClaim,
	response *integrationdto.ImportAzureDevOpsKnowledgeResponse,
) error {
	claim.Response = response
	encoded, err := json.Marshal(claim)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	return s.Cache.SetXX(ctx, claim.Key, encoded, knowledgeImportRequestTTL).Err()
}

func (s *Service) releaseKnowledgeImport(ctx context.Context, claim *knowledgeImportClaim) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := s.Cache.Del(ctx, claim.Key).Err(); err != nil {
		logger.CtxWarn(ctx, "could not release Knowledge import request: %v", err)
	}
}
