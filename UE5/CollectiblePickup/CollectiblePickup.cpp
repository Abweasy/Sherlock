// CollectiblePickup.cpp

#include "CollectiblePickup.h"

#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/Engine.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerState.h"
#include "Kismet/GameplayStatics.h"
#include "UObject/ConstructorHelpers.h"

ACollectiblePickup::ACollectiblePickup()
{
	PrimaryActorTick.bCanEverTick = true;

	// The sphere is the root so the trigger area stays put while the mesh bobs.
	CollisionSphere = CreateDefaultSubobject<USphereComponent>(TEXT("CollisionSphere"));
	CollisionSphere->InitSphereRadius(60.f);
	CollisionSphere->SetCollisionProfileName(TEXT("OverlapAllDynamic"));
	RootComponent = CollisionSphere;

	// The mesh is just for looks, so it shouldn't block the player.
	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	Mesh->SetupAttachment(CollisionSphere);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Mesh->SetRelativeScale3D(FVector(0.5f));

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeMesh(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (CubeMesh.Succeeded())
	{
		Mesh->SetStaticMesh(CubeMesh.Object);
	}
}

void ACollectiblePickup::BeginPlay()
{
	Super::BeginPlay();

	MeshStartLocation = Mesh->GetRelativeLocation();
	CollisionSphere->OnComponentBeginOverlap.AddDynamic(this, &ACollectiblePickup::OnOverlapBegin);
}

void ACollectiblePickup::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	RunningTime += DeltaTime;

	// Spin around the vertical axis and bob up and down on a sine wave.
	Mesh->AddLocalRotation(FRotator(0.f, RotationSpeed * DeltaTime, 0.f));
	Mesh->SetRelativeLocation(MeshStartLocation + FVector(0.f, 0.f, FMath::Sin(RunningTime * BobSpeed) * BobHeight));
}

void ACollectiblePickup::OnOverlapBegin(UPrimitiveComponent* OverlappedComponent, AActor* OtherActor,
	UPrimitiveComponent* OtherComp, int32 OtherBodyIndex, bool bFromSweep, const FHitResult& SweepResult)
{
	// Only the player can collect it, not AI or physics objects.
	APawn* Pawn = Cast<APawn>(OtherActor);
	if (!Pawn || !Pawn->IsPlayerControlled())
	{
		return;
	}

	// PlayerState already has a Score value built in, so no custom GameMode is needed.
	if (APlayerState* PlayerState = Pawn->GetPlayerState())
	{
		PlayerState->SetScore(PlayerState->GetScore() + Points);

		if (GEngine)
		{
			GEngine->AddOnScreenDebugMessage(-1, 2.f, FColor::Yellow,
				FString::Printf(TEXT("+%d points! Score: %.0f"), Points, PlayerState->GetScore()));
		}
	}

	if (PickupSound)
	{
		UGameplayStatics::PlaySoundAtLocation(this, PickupSound, GetActorLocation());
	}

	OnCollected(Pawn);
	Destroy();
}
