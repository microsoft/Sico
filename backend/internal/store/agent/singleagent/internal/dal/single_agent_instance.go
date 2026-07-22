package dal

import (
	"context"

	"gorm.io/gorm"

	entity "sico-backend/internal/entity/agent/singleagent"
	"sico-backend/internal/store/agent/singleagent/internal/dal/model"
	"sico-backend/internal/store/agent/singleagent/internal/dal/query"
	"sico-backend/internal/transport/http/dto/agent/single_agent"
	commondto "sico-backend/internal/transport/http/dto/common"
)

type SingleAgentInstanceDAO struct {
	dbQuery *query.Query
}

func NewSingleAgentInstanceDAO(db *gorm.DB) *SingleAgentInstanceDAO {
	return &SingleAgentInstanceDAO{
		dbQuery: query.Use(db),
	}
}

func (sai *SingleAgentInstanceDAO) Create(ctx context.Context, instance *entity.SingleAgentInstance) (int64, error) {
	po := sai.singleAgentInstanceDo2Po(instance)
	err := sai.dbQuery.TSingleAgentInstance.WithContext(ctx).Create(po)
	if err != nil {
		return 0, err
	}

	return po.ID, nil
}

func (sai *SingleAgentInstanceDAO) Get(ctx context.Context, id int64) (*entity.SingleAgentInstance, error) {
	saim := sai.dbQuery.TSingleAgentInstance
	instance, err := saim.WithContext(ctx).Where(saim.ID.Eq(id)).First()

	if err != nil {
		return nil, err
	}

	return sai.singleAgentInstancePo2Do(instance), nil
}

func (sai *SingleAgentInstanceDAO) MGet(ctx context.Context, ids []int64) ([]*entity.SingleAgentInstance, error) {
	saim := sai.dbQuery.TSingleAgentInstance
	instances, err := saim.WithContext(ctx).Where(saim.ID.In(ids...)).Find()
	if err != nil {
		return nil, err
	}

	agentS := make([]*entity.SingleAgentInstance, 0, len(instances))
	for _, instance := range instances {
		agentS = append(agentS, sai.singleAgentInstancePo2Do(instance))
	}

	return agentS, nil
}

func (sai *SingleAgentInstanceDAO) UpdateStatus(
	ctx context.Context, id int64, status single_agent.SingleAgentInstanceStatus,
) error {
	saim := sai.dbQuery.TSingleAgentInstance
	_, err := saim.WithContext(ctx).Where(saim.ID.Eq(id)).Update(saim.Status, int32(status))
	return err
}

func (sai *SingleAgentInstanceDAO) Update(
	ctx context.Context, instanceInfo *entity.SingleAgentInstance,
) error {
	po := sai.singleAgentInstanceDo2Po(instanceInfo)
	saim := sai.dbQuery.TSingleAgentInstance
	_, err := saim.WithContext(ctx).Where(saim.ID.Eq(instanceInfo.Id)).Updates(po)
	if err != nil {
		return err
	}

	return nil
}

func (sai *SingleAgentInstanceDAO) Delete(ctx context.Context, id int64) error {
	saim := sai.dbQuery.TSingleAgentInstance
	_, err := saim.WithContext(ctx).Where(saim.ID.Eq(id)).Delete()

	return err
}

func (sai *SingleAgentInstanceDAO) ListByFilter(
	ctx context.Context,
	filter *entity.ListSingleAgentInstanceFilter,
	offset, limit int,
) ([]*entity.SingleAgentInstance, int64, error) {
	saim := sai.dbQuery.TSingleAgentInstance
	saimQuery := saim.WithContext(ctx)

	if filter.EmployerUsername != nil {
		saimQuery = saimQuery.Where(saim.EmployerUsername.Eq(*filter.EmployerUsername))
	}

	if filter.OperatorUsername != nil {
		saimQuery = saimQuery.Where(saim.OperatorUsername.Eq(*filter.OperatorUsername))
	}

	if filter.FilterByStatus && len(filter.StatusArr) > 0 {
		var status []int32
		for _, s := range filter.StatusArr {
			status = append(status, int32(s))
		}
		saimQuery = saimQuery.Where(saim.Status.In(status...))
	}

	if filter.Role != nil {
		saimQuery = saimQuery.Where(saim.Role.Eq(*filter.Role))
	}

	if filter.ProjectId != nil {
		saimQuery = saimQuery.Where(saim.ProjectID.Eq(*filter.ProjectId))
	}

	if filter.AgentId != nil {
		saimQuery = saimQuery.Where(saim.AgentID.Eq(*filter.AgentId))
	}

	saimQuery = sai.applyInstanceSorting(saimQuery, filter)

	count, err := saimQuery.Count()
	if err != nil {
		return nil, 0, err
	}

	saimQuery = saimQuery.Offset(offset)
	if limit > 0 {
		saimQuery = saimQuery.Limit(limit)
	}

	pos, err := saimQuery.Find()
	if err != nil {
		return nil, 0, err
	}

	entities := make([]*entity.SingleAgentInstance, len(pos))
	for i, po := range pos {
		entities[i] = sai.singleAgentInstancePo2Do(po)
	}

	return entities, count, nil
}

func (sai *SingleAgentInstanceDAO) applyInstanceSorting(
	q query.ITSingleAgentInstanceDo, filter *entity.ListSingleAgentInstanceFilter,
) query.ITSingleAgentInstanceDo {
	saim := sai.dbQuery.TSingleAgentInstance
	isAsc := filter.SortOrder == commondto.SortOrder_SORT_ORDER_ASC

	switch filter.OrderBy {
	case single_agent.SingleAgentInstanceOrderBy_SINGLE_AGENT_INSTANCE_ORDER_BY_UPDATED_AT:
		if isAsc {
			return q.Order(saim.UpdatedAt.Asc())
		}
		return q.Order(saim.UpdatedAt.Desc())
	case single_agent.SingleAgentInstanceOrderBy_SINGLE_AGENT_INSTANCE_ORDER_BY_STATUS_UPDATED_AT:
		if isAsc {
			return q.Order(saim.Status.Asc(), saim.UpdatedAt.Desc())
		}
		return q.Order(saim.Status.Desc(), saim.UpdatedAt.Asc())
	default:
		if isAsc {
			return q.Order(saim.ID.Asc())
		}
		return q.Order(saim.ID.Desc())
	}
}

func (sai *SingleAgentInstanceDAO) singleAgentInstancePo2Do(po *model.TSingleAgentInstance) *entity.SingleAgentInstance {
	var desc, permission string

	if po.Description != nil {
		desc = *po.Description
	}
	if po.Permission != nil {
		permission = *po.Permission
	}

	return &entity.SingleAgentInstance{
		SingleAgentInstance: &single_agent.SingleAgentInstance{
			Id:                 po.ID,
			AgentId:            po.AgentID,
			EmployerUsername:   po.EmployerUsername,
			OperatorUsername:   po.OperatorUsername,
			Name:               po.Name,
			Role:               po.Role,
			Desc:               desc,
			IconUri:            po.IconURI,
			RawIconUri:         po.IconURI,
			EmployerIconUri:    po.EmployerIconURI,
			RawEmployerIconUri: po.EmployerIconURI,
			ProjectId:          po.ProjectID,
			Permission:         permission,
			Status:             single_agent.SingleAgentInstanceStatus(po.Status),
			Attachments:        po.Attachments,
			CreatedAt:          po.CreatedAt,
			UpdatedAt:          po.UpdatedAt,
		},
	}
}

func (sai *SingleAgentInstanceDAO) singleAgentInstanceDo2Po(do *entity.SingleAgentInstance) *model.TSingleAgentInstance {
	instance := &model.TSingleAgentInstance{
		ID:               do.Id,
		AgentID:          do.AgentId,
		EmployerUsername: do.EmployerUsername,
		OperatorUsername: do.OperatorUsername,
		Name:             do.Name,
		ProjectID:        do.ProjectId,
		Role:             do.Role,
		IconURI:          do.IconUri,
		EmployerIconURI:  do.EmployerIconUri,
		CreatedAt:        do.CreatedAt,
		UpdatedAt:        do.UpdatedAt,
		Attachments:      do.Attachments,
	}

	if len(do.Desc) > 0 {
		instance.Description = &do.Desc
	}
	if len(do.Permission) > 0 {
		instance.Permission = &do.Permission
	}

	return instance
}
