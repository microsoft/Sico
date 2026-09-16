package providers

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	sandboximpl "sico-backend/internal/biz/sandbox/impl"
	"sico-backend/internal/shared/enum"
)

const (
	sandboxLinuxWorkstationK8sEnabled     = "SANDBOX_LINUX_WORKSTATION_K8S"
	sandboxLinuxWorkstationKubeconfig     = "SANDBOX_LINUX_WORKSTATION_KUBECONFIG"
	sandboxLinuxWorkstationK8sNamespace   = "SANDBOX_LINUX_WORKSTATION_K8S_NAMESPACE"
	sandboxLinuxWorkstationK8sService     = "SANDBOX_LINUX_WORKSTATION_K8S_SERVICE"
	sandboxLinuxWorkstationK8sStatefulSet = "SANDBOX_LINUX_WORKSTATION_K8S_STATEFULSET"
	sandboxLinuxWorkstationK8sPodSelector = "SANDBOX_LINUX_WORKSTATION_K8S_POD_SELECTOR"
	sandboxLinuxWorkstationK8sPort        = "SANDBOX_LINUX_WORKSTATION_K8S_PORT"
	sandboxLinuxWorkstationK8sMinIdle     = "SANDBOX_LINUX_WORKSTATION_K8S_MIN_IDLE"
	sandboxLinuxWorkstationK8sMaxIdle     = "SANDBOX_LINUX_WORKSTATION_K8S_MAX_IDLE"
	sandboxLinuxWorkstationK8sMaxReplicas = "SANDBOX_LINUX_WORKSTATION_K8S_MAX_REPLICAS"
)

type linuxWorkstationK8sClient struct {
	client      *kubernetes.Clientset
	namespace   string
	serviceName string
	port        int
	selector    string
	minIdle     int
	maxIdle     int
	maxReplicas int
	statefulSet string
	enabled     bool
}

func newLinuxWorkstationK8sClient() *linuxWorkstationK8sClient {
	if !strings.EqualFold(os.Getenv(sandboxLinuxWorkstationK8sEnabled), "true") {
		return nil
	}

	config, err := buildKubeConfig()
	if err != nil {
		return nil
	}
	client, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil
	}
	return &linuxWorkstationK8sClient{
		client:      client,
		namespace:   getEnvOrDefault(sandboxLinuxWorkstationK8sNamespace, "sandbox"),
		serviceName: getEnvOrDefault(sandboxLinuxWorkstationK8sService, "linux-workstation-sandbox"),
		port:        getEnvInt(sandboxLinuxWorkstationK8sPort, 8080),
		selector:    getEnvOrDefault(sandboxLinuxWorkstationK8sPodSelector, "app=linux-workstation-sandbox"),
		minIdle:     getEnvInt(sandboxLinuxWorkstationK8sMinIdle, 5),
		maxIdle:     getEnvInt(sandboxLinuxWorkstationK8sMaxIdle, 8),
		maxReplicas: getEnvInt(sandboxLinuxWorkstationK8sMaxReplicas, 30),
		statefulSet: getEnvOrDefault(sandboxLinuxWorkstationK8sStatefulSet, "linux-workstation-sandbox"),
		enabled:     true,
	}
}

func buildKubeConfig() (*rest.Config, error) {
	if kubeconfig := os.Getenv(sandboxLinuxWorkstationKubeconfig); kubeconfig != "" {
		kubeconfig = strings.TrimSpace(os.ExpandEnv(kubeconfig))
		if strings.HasPrefix(kubeconfig, "~") {
			if home, err := os.UserHomeDir(); err == nil && home != "" {
				kubeconfig = filepath.Join(home, strings.TrimPrefix(kubeconfig, "~"))
			}
		}
		return clientcmd.BuildConfigFromFlags("", kubeconfig)
	}
	return rest.InClusterConfig()
}

func (k *linuxWorkstationK8sClient) ListResources(ctx context.Context, workspace string) ([]*sandboximpl.Resource, error) {
	if k == nil || !k.enabled {
		return []*sandboximpl.Resource{}, nil
	}
	selector, err := labels.Parse(k.selector)
	if err != nil {
		return nil, err
	}
	pods, err := k.client.CoreV1().Pods(k.namespace).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
	if err != nil {
		return nil, err
	}

	result := make([]*sandboximpl.Resource, 0, len(pods.Items))
	for _, pod := range pods.Items {
		status := sandboximpl.ResourceStatusAvailable
		if pod.Status.Phase != corev1.PodRunning || !isPodReady(&pod) {
			status = sandboximpl.ResourceStatusUnhealthy
		}
		base := fmt.Sprintf("http://%s.%s.%s.svc.cluster.local:%d", pod.Name, k.serviceName, k.namespace, k.port)
		directEndpoint := base
		if pod.Status.PodIP != "" {
			directEndpoint = fmt.Sprintf("http://%s:%d", pod.Status.PodIP, k.port)
		}
		result = append(result, &sandboximpl.Resource{
			Type: enum.SandboxTypeLinuxWorkstation.String(), ResourceID: base, DisplayName: pod.Name, Status: status,
			Metadata: map[string]string{
				"podName": pod.Name, "podIP": pod.Status.PodIP, "baseUrl": base,
				"directEndpoint": directEndpoint, "workspace": workspace,
				"apiDocsUrl": directEndpoint + "/docs", "vncUrl": directEndpoint + "/vnc/",
			},
		})
	}
	return result, nil
}

func (k *linuxWorkstationK8sClient) EnsureIdleRange(ctx context.Context, total, leased int) (bool, error) {
	if k == nil || !k.enabled {
		return false, nil
	}
	idle := total - leased
	if idle >= k.minIdle {
		if k.maxIdle > 0 && idle > k.maxIdle {
			return true, k.scaleTo(ctx, leased+k.maxIdle)
		}
		return false, nil
	}
	return true, k.scaleTo(ctx, leased+k.minIdle)
}

func (k *linuxWorkstationK8sClient) scaleTo(ctx context.Context, desiredTotal int) error {
	statefulSet, err := k.client.AppsV1().StatefulSets(k.namespace).Get(ctx, k.statefulSet, metav1.GetOptions{})
	if err != nil {
		return err
	}
	current := int32(0)
	if statefulSet.Spec.Replicas != nil {
		current = *statefulSet.Spec.Replicas
	}
	desired := int32(desiredTotal)
	if desired < 0 {
		desired = 0
	}
	if k.minIdle > 0 && int(desired) < k.minIdle {
		desired = int32(k.minIdle)
	}
	if k.maxReplicas > 0 && int(desired) > k.maxReplicas {
		desired = int32(k.maxReplicas)
	}
	if desired == current {
		return nil
	}
	statefulSet.Spec.Replicas = &desired
	_, err = k.client.AppsV1().StatefulSets(k.namespace).Update(ctx, statefulSet, metav1.UpdateOptions{})
	return err
}

func isPodReady(pod *corev1.Pod) bool {
	for _, condition := range pod.Status.Conditions {
		if condition.Type == corev1.PodReady {
			return condition.Status == corev1.ConditionTrue
		}
	}
	return false
}

func getEnvOrDefault(key, fallback string) string {
	if value := os.Getenv(key); strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
