package dal

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	entity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/store/agent/singleagent/internal/dal/model"
	"sico-backend/internal/store/agent/singleagent/internal/dal/query"
	"sico-backend/internal/transport/http/dto/agent/single_agent"
)

type SingleAgentDAO struct {
	dbQuery *query.Query
}

func NewSingleAgentDAO(db *gorm.DB) *SingleAgentDAO {
	return &SingleAgentDAO{
		dbQuery: query.Use(db),
	}
}

func (sa *SingleAgentDAO) Create(ctx context.Context, creatorUsername string, agent *entity.SingleAgent) error {
	po := sa.singleAgentDo2Po(agent)
	po.CreatorUsername = creatorUsername

	err := sa.dbQuery.TSingleAgent.WithContext(ctx).Create(po)
	if err != nil {
		return err
	}

	return nil
}

func (sa *SingleAgentDAO) Get(ctx context.Context, agentID string) (*entity.SingleAgent, error) {
	sam := sa.dbQuery.TSingleAgent
	singleAgent, err := sam.WithContext(ctx).Where(sam.AgentID.Eq(agentID)).First()

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return sa.singleAgentPo2Do(singleAgent), nil
}

func (sa *SingleAgentDAO) GetForUpdate(ctx context.Context, agentID string) (*entity.SingleAgent, error) {
	sam := sa.dbQuery.TSingleAgent
	singleAgent, err := sam.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(sam.AgentID.Eq(agentID)).
		First()

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return sa.singleAgentPo2Do(singleAgent), nil
}

func (sa *SingleAgentDAO) MGet(ctx context.Context, agentIDs []string) ([]*entity.SingleAgent, error) {
	sam := sa.dbQuery.TSingleAgent
	singleAgents, err := sam.WithContext(ctx).Where(sam.AgentID.In(agentIDs...)).Find()
	if err != nil {
		return nil, err
	}

	sas := make([]*entity.SingleAgent, 0, len(singleAgents))
	for _, singleAgent := range singleAgents {
		sas = append(sas, sa.singleAgentPo2Do(singleAgent))
	}

	return sas, nil
}

func (sa *SingleAgentDAO) Update(ctx context.Context, agentInfo *entity.SingleAgent) (err error) {
	po := sa.singleAgentDo2Po(agentInfo)
	sam := sa.dbQuery.TSingleAgent
	_, err = sam.WithContext(ctx).Where(sam.AgentID.Eq(agentInfo.AgentId)).Updates(po)
	if err != nil {
		return err
	}

	return nil
}

func (sa *SingleAgentDAO) Delete(ctx context.Context, agentID string) (err error) {
	sam := sa.dbQuery.TSingleAgent
	_, err = sam.WithContext(ctx).Where(sam.AgentID.Eq(agentID)).Delete()

	return err
}

func (sa *SingleAgentDAO) List(
	ctx context.Context,
	creatorUsername string, offset, limit int,
) ([]*entity.SingleAgent, int64, error) {
	sam := sa.dbQuery.TSingleAgent
	samQuery := sam.WithContext(ctx)

	if len(creatorUsername) > 0 {
		samQuery = samQuery.Where(sam.CreatorUsername.Eq(creatorUsername))
	}

	query := samQuery.Order(sam.UpdatedAt.Desc())

	total, err := query.Count()
	if err != nil {
		return nil, 0, err
	}

	pos, err := query.Offset(offset).Limit(limit).Find()
	if err != nil {
		return nil, 0, err
	}

	entities := make([]*entity.SingleAgent, len(pos))
	for i, po := range pos {
		entities[i] = sa.singleAgentPo2Do(po)
	}

	return entities, total, nil
}

// ListByFilter returns single agents matching the visibility filter used by the
// list endpoints. No pagination is applied — the full matching set is returned.
func (sa *SingleAgentDAO) ListByFilter(
	ctx context.Context, filter *entity.ListSingleAgentFilter,
) ([]*entity.SingleAgent, int64, error) {
	sam := sa.dbQuery.TSingleAgent
	q := sam.WithContext(ctx).UnderlyingDB().Model(&model.TSingleAgent{})

	if filter != nil {
		if !filter.Unrestricted {
			q = q.Where(buildVisibilityGroup(q.Session(&gorm.Session{NewDB: true}), filter))
		}
		if len(filter.PublishStatuses) > 0 {
			q = q.Where("publish_status IN ?", filter.PublishStatuses)
		}
		if filter.OrganizationID != nil {
			q = q.Where("organization_id = ?", *filter.OrganizationID)
		}
	}

	var total int64
	if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var pos []*model.TSingleAgent
	if err := q.Order("updated_at DESC").Find(&pos).Error; err != nil {
		return nil, 0, err
	}

	entities := make([]*entity.SingleAgent, len(pos))
	for i, po := range pos {
		entities[i] = sa.singleAgentPo2Do(po)
	}

	return entities, total, nil
}

// buildVisibilityGroup renders the OR-of-groups visibility predicate as a single
// grouped condition. When no group is populated it matches nothing (1 = 0).
func buildVisibilityGroup(g *gorm.DB, filter *entity.ListSingleAgentFilter) *gorm.DB {
	populated := false
	add := func(query string, args ...interface{}) {
		if populated {
			g = g.Or(query, args...)
		} else {
			g = g.Where(query, args...)
			populated = true
		}
	}

	if filter.IncludeOrgFreeAgents {
		add("organization_id = ?", 0)
	}
	if filter.IncludeOrgFreePublishedOnly {
		add("(organization_id = ? AND publish_status = ?)", 0, 1)
	}
	if len(filter.VisibleOrgIDs) > 0 {
		add("organization_id IN ?", filter.VisibleOrgIDs)
	}
	switch {
	case filter.OwnerUsername != "" && len(filter.ManagedAgentIDs) > 0:
		add("(creator_username = ? OR agent_id IN ?)", filter.OwnerUsername, filter.ManagedAgentIDs)
	case filter.OwnerUsername != "":
		add("creator_username = ?", filter.OwnerUsername)
	case len(filter.ManagedAgentIDs) > 0:
		add("agent_id IN ?", filter.ManagedAgentIDs)
	}

	if !populated {
		g = g.Where("1 = 0")
	}
	return g
}

func (sa *SingleAgentDAO) ListInfos(ctx context.Context) ([]*single_agent.SingleAgentInfo, error) {
	sam := sa.dbQuery.TSingleAgent

	var results []struct {
		AgentID         string
		Role            string
		Name            string
		CreatorUsername string
	}

	err := sam.WithContext(ctx).
		Select(sam.AgentID, sam.Role, sam.Name, sam.CreatorUsername).
		Where(sam.Role.IsNotNull()).
		Where(sam.Role.Neq("")).
		Scan(&results)

	if err != nil {
		return nil, err
	}

	// Convert to SingleAgentInfo
	agentInfos := make([]*single_agent.SingleAgentInfo, len(results))
	for i, result := range results {
		agentInfos[i] = &single_agent.SingleAgentInfo{
			AgentId:         result.AgentID,
			Role:            result.Role,
			Name:            result.Name,
			CreatorUsername: result.CreatorUsername,
		}
	}

	return agentInfos, nil
}

func (sa *SingleAgentDAO) Count(ctx context.Context, creatorUsername string) (int64, error) {
	if len(creatorUsername) == 0 {
		return 0, nil
	}

	sam := sa.dbQuery.TSingleAgent
	samQuery := sam.WithContext(ctx)

	if len(creatorUsername) > 0 {
		samQuery = samQuery.Where(sam.CreatorUsername.Eq(creatorUsername))
	}

	count, err := samQuery.Count()
	if err != nil {
		return 0, err
	}

	return count, nil
}

func (sa *SingleAgentDAO) singleAgentPo2Do(po *model.TSingleAgent) *entity.SingleAgent {
	var desc string
	if po.Description != nil {
		desc = *po.Description
	}

	return &entity.SingleAgent{
		SingleAgent: &single_agent.SingleAgent{
			AgentId:         po.AgentID,
			CreatorUsername: po.CreatorUsername,
			Name:            po.Name,
			Role:            po.Role,
			Desc:            desc,
			IconUri:         po.IconURI,
			RawIconUri:      po.IconURI,
			CreatedAt:       po.CreatedAt,
			UpdatedAt:       po.UpdatedAt,
			UpdaterUsername: po.UpdaterUsername,
			OrganizationId:  po.OrganizationID,
			PublishStatus:   single_agent.SingleAgentPublishStatus(po.PublishStatus),
		},
	}
}

func (sa *SingleAgentDAO) singleAgentDo2Po(do *entity.SingleAgent) *model.TSingleAgent {
	agent := &model.TSingleAgent{
		AgentID:         do.AgentId,
		CreatorUsername: do.CreatorUsername,
		Name:            do.Name,
		Role:            do.Role,
		IconURI:         do.IconUri,
		CreatedAt:       do.CreatedAt,
		UpdatedAt:       do.UpdatedAt,
		UpdaterUsername: do.UpdaterUsername,
		OrganizationID:  do.OrganizationId,
		PublishStatus:   int64(do.PublishStatus),
	}

	if len(do.Desc) > 0 {
		agent.Description = &do.Desc
	}

	return agent
}
